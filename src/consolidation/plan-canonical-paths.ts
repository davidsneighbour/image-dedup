import { access } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { ImageOriginConfig } from "../config/schema.js";
import type { ImageRecord } from "../domain/image-record.js";
import { sha256File } from "../inventory/exact-hash.js";
import {
  appendSuffixToBasename,
  collisionKey,
  sanitiseFilenameComponent,
  slugify,
} from "./sanitise-filename.js";
import { selectDate } from "./select-date.js";
import type { SelectedOriginal } from "./select-originals.js";

const FORMAT_EXTENSIONS: Record<string, string> = {
  jpeg: ".jpg",
  png: ".png",
  webp: ".webp",
  avif: ".avif",
  gif: ".gif",
};

function extensionFor(record: ImageRecord): string {
  const fromPath = extname(record.relativePath);
  if (fromPath) return fromPath.toLowerCase();
  return FORMAT_EXTENSIONS[record.image.format] ?? `.${record.image.format}`;
}

function baseNameWithoutExtension(record: ImageRecord): string {
  return basename(record.relativePath, extname(record.relativePath));
}

function renderTemplate(
  template: string,
  record: ImageRecord,
  selection: SelectedOriginal,
  ext: string,
): string {
  const { date } = selectDate(record);
  const replacements: Record<string, string> = {
    year: date ? String(date.getUTCFullYear()) : "unknown-date",
    slug: slugify(baseNameWithoutExtension(record)),
    shortHash: record.file.sha256.slice(0, 8),
    ext: ext.startsWith(".") ? ext.slice(1) : ext,
    groupId: selection.groupIds[0] ?? "standalone",
    id: record.id,
  };

  const rendered = template.replace(/\{(\w+)\}/g, (match, token: string) =>
    Object.hasOwn(replacements, token) ? (replacements[token] ?? match) : match,
  );

  return rendered
    .split("/")
    .map((segment) => sanitiseFilenameComponent(segment))
    .join("/");
}

/**
 * Builds the un-suffixed canonical relative path for one selected image,
 * per its naming strategy (PLAN.md §22.1). Collision resolution (§22.4)
 * happens in `planCanonicalPaths`, one layer up.
 */
function buildBasePath(
  record: ImageRecord,
  selection: SelectedOriginal,
  consolidation: ImageOriginConfig["consolidation"],
  warnings: string[],
): string {
  const ext = consolidation.preserveExtension ? extensionFor(record) : "";

  switch (consolidation.naming) {
    case "original-filename":
      return `${sanitiseFilenameComponent(baseNameWithoutExtension(record))}${ext}`;

    case "sanitised-filename":
      return `${slugify(baseNameWithoutExtension(record))}${ext}`;

    case "content-hash":
      return `${record.file.sha256.slice(0, 16)}${ext}`;

    case "date-slug": {
      const { date, source } = selectDate(record);
      if (source === "filesystem-modified-weak") {
        warnings.push(
          "Canonical date derived from filesystem modification time (a weak fallback), not a trusted capture date.",
        );
      }
      const slug = slugify(baseNameWithoutExtension(record));
      if (!date) {
        return `unknown-date/${slug}${ext}`;
      }
      const isoDate = date.toISOString().slice(0, 10);
      return `${date.getUTCFullYear()}/${isoDate}-${slug}${ext}`;
    }

    case "group-id": {
      const groupId = selection.groupIds[0];
      const base = groupId ? sanitiseFilenameComponent(groupId) : `standalone-${record.id}`;
      return `${base}${ext}`;
    }

    case "template":
      // `configSchema` requires `template` whenever `naming` is `"template"`.
      return renderTemplate(consolidation.template ?? "", record, selection, ext);
  }
}

export type CanonicalPathPlanStatus = "planned" | "reuse-existing" | "collision";

export interface CanonicalPathPlanEntry {
  imageId: string;
  sourcePath: string;
  sourceRelativePath: string;
  sourceSha256: string;
  canonicalRelativePath: string;
  canonicalPath: string;
  status: CanonicalPathPlanStatus;
  collisionReason?: string;
  warnings: string[];
  selection: SelectedOriginal;
}

export interface PlanCanonicalPathsOptions {
  /** Absolute path. */
  originalsDirectory: string;
  consolidation: ImageOriginConfig["consolidation"];
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Plans a collision-free (or explicitly collision-flagged) canonical
 * destination for every selected image (PLAN.md §22). Pure with respect
 * to the selection input, but does read the filesystem (existing files
 * under `originalsDirectory`) to detect collisions against prior runs or
 * unrelated content already there — that's unavoidable for correctness,
 * since PLAN.md §22.4's "reuse identical content" policy can only be
 * decided by comparing against what's actually on disk.
 *
 * Entries are processed in a fixed order (`imageId`) so that, given the
 * same selection and the same starting filesystem state, the same
 * collision resolution (e.g. which of two colliding names gets a
 * hash suffix) happens every time.
 */
export async function planCanonicalPaths(
  selected: readonly SelectedOriginal[],
  recordsById: ReadonlyMap<string, ImageRecord>,
  options: PlanCanonicalPathsOptions,
): Promise<CanonicalPathPlanEntry[]> {
  const usedKeys = new Set<string>();
  const entries: CanonicalPathPlanEntry[] = [];

  const sortedSelected = [...selected].sort((a, b) => a.imageId.localeCompare(b.imageId));

  for (const selection of sortedSelected) {
    const record = recordsById.get(selection.imageId);
    if (!record) continue;

    const warnings: string[] = [];
    const basePath = buildBasePath(record, selection, options.consolidation, warnings);

    let candidatePath = basePath;
    let status: CanonicalPathPlanStatus = "planned";
    let collisionReason: string | undefined;

    const maxAttempts = 20;
    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      const key = collisionKey(candidatePath);
      const inRunConflict = usedKeys.has(key);
      const absoluteCandidate = join(options.originalsDirectory, candidatePath);
      const existsOnDisk = !inRunConflict && (await pathExists(absoluteCandidate));

      if (!inRunConflict && !existsOnDisk) {
        status = "planned";
        collisionReason = undefined;
        break;
      }

      if (existsOnDisk && options.consolidation.collisionPolicy === "reuse-identical") {
        const destinationHash = await sha256File(absoluteCandidate).catch(() => undefined);
        if (destinationHash === record.file.sha256) {
          status = "reuse-existing";
          collisionReason = undefined;
          break;
        }
      }

      if (options.consolidation.collisionPolicy === "append-hash" && attempt < maxAttempts) {
        candidatePath = appendSuffixToBasename(basePath, record.file.sha256.slice(0, 8 + attempt));
        continue;
      }

      status = "collision";
      collisionReason = inRunConflict
        ? `canonical path collides with another selected image in this run: "${candidatePath}"`
        : `destination already exists and is not identical content: "${candidatePath}"`;
      break;
    }

    if (status !== "collision") {
      usedKeys.add(collisionKey(candidatePath));
    }

    entries.push({
      imageId: selection.imageId,
      sourcePath: record.realPath,
      sourceRelativePath: record.relativePath,
      sourceSha256: record.file.sha256,
      canonicalRelativePath: candidatePath,
      canonicalPath: join(options.originalsDirectory, candidatePath),
      status,
      ...(collisionReason ? { collisionReason } : {}),
      warnings,
      selection,
    });
  }

  return entries;
}
