import { z } from "zod";

/**
 * The canonical manifest for retained originals (PLAN.md §24), written to
 * `<originalsDirectory>/manifest.json` after a successful `consolidate
 * --apply` (gated by `consolidation.writeManifest`). A preview of the same
 * shape — covering only what *would* be written — is always saved to
 * `<workspace>/manifest.preview.json` by the path planner, dry-run or not
 * (PLAN.md §23.1 step 6).
 */

export interface CanonicalManifestRelationship {
  path: string;
  /** `ImageRelationship` in practice (see `src/domain/relationship.ts`); kept as a bare string here for the same reason `ImageComparison.relationship` is, per `src/domain/image-group.ts`. */
  type: string;
  confidence: number;
}

export type CanonicalManifestSelectionMethod = "automatic" | "manual" | "standalone";

export interface CanonicalManifestImage {
  id: string;
  /** Relative to the originals directory, e.g. `2014/beach-at-lamai.jpg`. */
  canonicalPath: string;
  sha256: string;
  width: number;
  height: number;
  format: string;
  hasAlpha: boolean;
  /** Historical source paths this file was chosen over or merged from — never includes `canonicalPath`'s own source. */
  selectedFrom: string[];
  relationships: CanonicalManifestRelationship[];
  selection: {
    method: CanonicalManifestSelectionMethod;
    confidence: number;
    reasons: string[];
  };
}

export interface CanonicalManifest {
  schemaVersion: 1;
  generatedAt: string;
  toolVersion: string;
  images: CanonicalManifestImage[];
}

const relationshipSchema = z
  .object({
    path: z.string().min(1),
    type: z.string().min(1),
    confidence: z.number().min(0).max(1),
  })
  .strict();

const selectionSchema = z
  .object({
    method: z.enum(["automatic", "manual", "standalone"]),
    confidence: z.number().min(0).max(1),
    reasons: z.array(z.string()),
  })
  .strict();

const manifestImageSchema = z
  .object({
    id: z.string().min(1),
    canonicalPath: z.string().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    format: z.string().min(1),
    hasAlpha: z.boolean(),
    selectedFrom: z.array(z.string()),
    relationships: z.array(relationshipSchema),
    selection: selectionSchema,
  })
  .strict();

export const canonicalManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: z.string().min(1),
    toolVersion: z.string().min(1),
    images: z.array(manifestImageSchema),
  })
  .strict();
