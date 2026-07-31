import type { ImageRecord } from "../domain/image-record.js";
import type { CanonicalManifest } from "../domain/manifest.js";
import type { CanonicalPathPlanEntry } from "./plan-canonical-paths.js";

export interface BuildCanonicalManifestOptions {
  entries: readonly CanonicalPathPlanEntry[];
  recordsById: ReadonlyMap<string, ImageRecord>;
  toolVersion: string;
  generatedAt?: Date;
}

/**
 * Assembles the canonical manifest (PLAN.md §24) from planned entries.
 * Pure and deterministic: sorted by `canonicalPath` regardless of the
 * order entries were planned or copied in. Callers pass only the entries
 * that should actually appear — the plan preview passes every non-collision
 * entry, while the post-apply manifest additionally excludes any entry
 * whose copy failed verification.
 */
export function buildCanonicalManifest(options: BuildCanonicalManifestOptions): CanonicalManifest {
  const images = options.entries
    .map((entry) => {
      const record = options.recordsById.get(entry.imageId);
      if (!record) return undefined;
      return {
        id: record.id,
        canonicalPath: entry.canonicalRelativePath,
        sha256: record.file.sha256,
        width: record.image.width,
        height: record.image.height,
        format: record.image.format,
        hasAlpha: record.image.hasAlpha,
        selectedFrom: entry.selection.selectedFrom,
        relationships: entry.selection.relationships,
        selection: entry.selection.selection,
      };
    })
    .filter((image): image is NonNullable<typeof image> => Boolean(image))
    .sort((a, b) => a.canonicalPath.localeCompare(b.canonicalPath));

  return {
    schemaVersion: 1,
    generatedAt: (options.generatedAt ?? new Date()).toISOString(),
    toolVersion: options.toolVersion,
    images,
  };
}
