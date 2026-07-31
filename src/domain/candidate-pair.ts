/**
 * A perceptual candidate signal between two images (PLAN.md §10). This is
 * deliberately *not* an `ImageGroup` — a hash match is only a candidate
 * signal, not confirmation (§10.2). Confirmation (SSIM, alpha comparison,
 * rotation checks) and relationship classification happen in M5; only
 * then do candidates become groups with a relationship and confidence.
 */
export interface PerceptualCandidatePair {
  a: string;
  b: string;
  dHashDistance: number;
  pHashDistance: number;
  aspectRatioDelta: number;
}
