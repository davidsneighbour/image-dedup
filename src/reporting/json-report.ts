import { createHash } from "node:crypto";
import { z } from "zod";
import type { ErrorReport } from "../cli/output.js";
import { type ImageOriginConfig, configSchema } from "../config/schema.js";
import { type ImageGroup, imageGroupSchema } from "../domain/image-group.js";
import type { ImageRecord } from "../domain/image-record.js";

/**
 * The machine-readable JSON report (PLAN.md §19). Written to
 * `<workspace>/audit.json` and, verbatim, embedded into the static HTML
 * report so the HTML stays usable without a server (PLAN.md §20.4, §31).
 */

export interface JsonReportImageAssets {
  /** Relative to the report directory (e.g. `assets/thumbnails/<hash>.webp`). */
  thumbnail?: string;
  centerCrop?: string;
  detailCrop?: string;
}

export interface JsonReportImage {
  id: string;
  /** Relative to its input directory. Never absolute unless `--absolute-paths` was requested (PLAN.md §19: "no absolute paths unless explicitly requested"). */
  path: string;
  absolutePath?: string;
  sha256: string;
  format: string;
  width: number;
  height: number;
  aspectRatio: number;
  hasAlpha: boolean;
  bitDepth?: number;
  fileSizeBytes: number;
  metadata: ImageRecord["metadata"];
  quality: ImageRecord["quality"];
  warnings: string[];
  assets?: JsonReportImageAssets;
}

export interface JsonReportSummary {
  filesDiscovered: number;
  filesInspected: number;
  exactDuplicateGroups: number;
  visualGroups: number;
  manualReviewGroups: number;
  ambiguousGroups: number;
  automaticRecommendations: number;
  errors: number;
}

export interface JsonReport {
  schemaVersion: 1;
  generatedAt: string;
  toolVersion: string;
  configFingerprint: string;
  repositoryRoot?: string;
  config: ImageOriginConfig;
  summary: JsonReportSummary;
  images: JsonReportImage[];
  groups: ImageGroup[];
  errors: ErrorReport[];
}

const imageMetadataSchema = z
  .object({
    exifPresent: z.boolean(),
    iptcPresent: z.boolean(),
    xmpPresent: z.boolean(),
    iccPresent: z.boolean(),
    captureDate: z.string().optional(),
    cameraMake: z.string().optional(),
    cameraModel: z.string().optional(),
    copyright: z.string().optional(),
    creator: z.string().optional(),
  })
  .strict();

const imageQualitySchema = z
  .object({
    detailScore: z.number().optional(),
    sharpnessScore: z.number().optional(),
    compressionScore: z.number().optional(),
    noiseScore: z.number().optional(),
    probableUpscale: z.boolean().optional(),
    probableRecompression: z.boolean().optional(),
  })
  .strict();

const imageAssetsSchema = z
  .object({
    thumbnail: z.string().min(1).optional(),
    centerCrop: z.string().min(1).optional(),
    detailCrop: z.string().min(1).optional(),
  })
  .strict();

const jsonReportImageSchema = z
  .object({
    id: z.string().min(1),
    path: z.string().min(1),
    absolutePath: z.string().min(1).optional(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    format: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    aspectRatio: z.number().positive(),
    hasAlpha: z.boolean(),
    bitDepth: z.number().int().positive().optional(),
    fileSizeBytes: z.number().int().nonnegative(),
    metadata: imageMetadataSchema,
    quality: imageQualitySchema,
    warnings: z.array(z.string()),
    assets: imageAssetsSchema.optional(),
  })
  .strict();

const errorReportSchema = z
  .object({
    phase: z.string().min(1),
    filePath: z.string().min(1).optional(),
    operation: z.string().min(1),
    error: z.string().min(1),
    continued: z.boolean(),
    remediation: z.string().min(1).optional(),
  })
  .strict();

const jsonReportSummarySchema = z
  .object({
    filesDiscovered: z.number().int().nonnegative(),
    filesInspected: z.number().int().nonnegative(),
    exactDuplicateGroups: z.number().int().nonnegative(),
    visualGroups: z.number().int().nonnegative(),
    manualReviewGroups: z.number().int().nonnegative(),
    ambiguousGroups: z.number().int().nonnegative(),
    automaticRecommendations: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
  })
  .strict();

export const jsonReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: z.string().min(1),
    toolVersion: z.string().min(1),
    configFingerprint: z.string().min(1),
    repositoryRoot: z.string().min(1).optional(),
    config: configSchema,
    summary: jsonReportSummarySchema,
    images: z.array(jsonReportImageSchema),
    groups: z.array(imageGroupSchema),
    errors: z.array(errorReportSchema),
  })
  .strict();

/** Stable across runs given the same resolved configuration (PLAN.md §19: "include a configuration fingerprint"). */
export function computeConfigFingerprint(config: ImageOriginConfig): string {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

export interface BuildJsonReportOptions {
  config: ImageOriginConfig;
  records: readonly ImageRecord[];
  groups: readonly ImageGroup[];
  errors: readonly ErrorReport[];
  toolVersion: string;
  /** When false (default), image paths are input-relative only — no filesystem layout is leaked. */
  absolutePaths: boolean;
  repositoryRoot?: string;
  assetsByRecordId?: ReadonlyMap<string, JsonReportImageAssets>;
  generatedAt?: Date;
}

function toJsonReportImage(record: ImageRecord, options: BuildJsonReportOptions): JsonReportImage {
  const assets = options.assetsByRecordId?.get(record.id);
  return {
    id: record.id,
    path: record.relativePath,
    ...(options.absolutePaths ? { absolutePath: record.realPath } : {}),
    sha256: record.file.sha256,
    format: record.image.format,
    width: record.image.width,
    height: record.image.height,
    aspectRatio: record.image.aspectRatio,
    hasAlpha: record.image.hasAlpha,
    ...(record.image.bitDepth !== undefined ? { bitDepth: record.image.bitDepth } : {}),
    fileSizeBytes: record.file.sizeBytes,
    metadata: { ...record.metadata },
    quality: { ...record.quality },
    warnings: record.warnings,
    ...(assets ? { assets } : {}),
  };
}

/**
 * Assembles the JSON report from already-persisted workspace state.
 * Deterministic ordering: images sorted by path then id, groups by id,
 * errors by file path then message — independent of whatever order the
 * caller's arrays happen to be in (PLAN.md §19: "deterministic ordering").
 *
 * `filesDiscovered`/`filesInspected` are both set to the persisted record
 * count: discovery-time skip counts (unsupported/inaccessible/duplicate
 * paths/symlinks) are transient to a single `audit` run and are not
 * persisted to the workspace database, so a standalone `report` run
 * (which may happen long after `audit`, against accumulated state) has no
 * way to recover them.
 */
export function buildJsonReport(options: BuildJsonReportOptions): JsonReport {
  const images = options.records
    .map((record) => toJsonReportImage(record, options))
    .sort((a, b) => a.path.localeCompare(b.path) || a.id.localeCompare(b.id));

  const groups = [...options.groups].sort((a, b) => a.id.localeCompare(b.id));
  const errors = [...options.errors].sort(
    (a, b) => (a.filePath ?? "").localeCompare(b.filePath ?? "") || a.error.localeCompare(b.error),
  );

  return {
    schemaVersion: 1,
    generatedAt: (options.generatedAt ?? new Date()).toISOString(),
    toolVersion: options.toolVersion,
    configFingerprint: computeConfigFingerprint(options.config),
    ...(options.repositoryRoot ? { repositoryRoot: options.repositoryRoot } : {}),
    config: options.config,
    summary: {
      filesDiscovered: options.records.length,
      filesInspected: options.records.length,
      exactDuplicateGroups: groups.filter((group) => group.kind === "exact-duplicate").length,
      visualGroups: groups.filter((group) => group.kind === "visual").length,
      manualReviewGroups: groups.filter((group) => group.status === "manual-review").length,
      ambiguousGroups: groups.filter((group) => group.status === "ambiguous").length,
      automaticRecommendations: groups.filter((group) => group.status === "automatic").length,
      errors: errors.length,
    },
    images,
    groups,
    errors,
  };
}

/** Throws with a human-readable message if `report` doesn't match `jsonReportSchema`. */
export function assertValidJsonReport(report: JsonReport): void {
  const result = jsonReportSchema.safeParse(report);
  if (!result.success) {
    const details = result.error.issues
      .map(
        (issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`,
      )
      .join("; ");
    throw new Error(`Generated JSON report failed schema validation: ${details}`);
  }
}
