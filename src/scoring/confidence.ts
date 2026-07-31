import type { CandidateScore } from "./score-candidate.js";

/**
 * Refines the group's confirmation-based confidence (from M5) into a
 * recommendation confidence (PLAN.md §18) using signals that only exist
 * once scoring has run. Score answers "how suitable is this candidate";
 * confidence answers "how certain are we this recommendation is correct"
 * — the two must stay separate (§18's opening framing).
 *
 * Only the §18.1 signals actually available at this stage are used:
 * visual-similarity strength and relationship unambiguity are already
 * baked into `baseGroupConfidence` from M5; "only perceptual hashes
 * match" and "one candidate is corrupted" can't apply to an
 * already-built, SSIM-confirmed group. Colour-treatment differences and
 * metadata conflicts aren't separately measured yet (no per-image
 * absolute colour-fidelity signal exists — see the scoring-weights
 * comment in `config/schema.ts`), so they don't feed in here either.
 */
export function computeRecommendationConfidence(
  baseGroupConfidence: number,
  scores: readonly CandidateScore[],
): number {
  let confidence = baseGroupConfidence;

  const sortedByScore = [...scores].sort((a, b) => b.total - a.total);
  const [top, second] = sortedByScore;

  if (top && second) {
    const margin = (top.total - second.total) / 100;
    if (margin >= 0.15) {
      // "one candidate clearly exceeds the others"
      confidence += 0.03;
    } else if (margin < 0.05) {
      // "two candidates have similar quality scores"
      confidence -= 0.05;
    }
  }

  const anyCrop = scores.some((score) => score.penalties.confirmedCrop > 0);
  if (anyCrop) {
    // "candidates have different crops"
    confidence -= 0.04;
  }

  const anyAlphaMismatch = scores.some(
    (score) => score.penalties.missingAlphaAvailableElsewhere > 0,
  );
  if (anyAlphaMismatch) {
    // "alpha differs"
    confidence -= 0.03;
  }

  if (
    top &&
    !anyCrop &&
    top.reasons.includes("contains the highest measurable genuine detail in this group")
  ) {
    // "the selected candidate has genuine additional detail" + "no crop or edit conflicts exist"
    confidence += 0.02;
  }

  return Math.max(0, Math.min(1, confidence));
}
