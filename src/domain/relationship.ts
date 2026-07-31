/**
 * Explicit relationship types between two images. See PLAN.md §5.2 — do not
 * collapse every relationship into a generic "duplicate".
 *
 * Only `exact-duplicate` is produced as of M3. The rest are listed now so
 * the shape doesn't need to change as later milestones (M4-M6) add the
 * detectors that produce them.
 */
export type ImageRelationship =
  | "exact-duplicate"
  | "metadata-only-difference"
  | "format-conversion"
  | "resize"
  | "recompression"
  | "resize-and-recompression"
  | "crop"
  | "rotation"
  | "mirrored"
  | "colour-adjusted"
  | "watermarked"
  | "upscaled"
  | "animation-frame"
  | "visually-related"
  | "unknown";
