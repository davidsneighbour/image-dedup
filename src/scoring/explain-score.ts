import type { ImageRecord } from "../domain/image-record.js";
import type { CandidateScore } from "./score-candidate.js";

export interface RecommendationExplanation {
  reasons: string[];
  warnings: string[];
}

/**
 * Composes the group-level reasons/warnings for a recommendation
 * (PLAN.md §17.5: "every recommendation must include positive and
 * negative reasons"). Reasons come from the winning candidate's own
 * score breakdown; warnings add why any *other* candidate wasn't
 * eligible, so a reviewer sees the full picture, not just the winner's
 * case.
 */
export function explainRecommendation(
  topScore: CandidateScore,
  allScores: readonly CandidateScore[],
  recordsById: ReadonlyMap<string, ImageRecord>,
): RecommendationExplanation {
  const reasons = [...topScore.reasons, `quality score ${topScore.total.toFixed(0)}/100`];
  const warnings = [...topScore.warnings];

  for (const other of allScores) {
    if (other.recordId === topScore.recordId || !other.disqualified) {
      continue;
    }
    const path = recordsById.get(other.recordId)?.relativePath ?? other.recordId;
    warnings.push(
      `"${path}" was not eligible for automatic selection: ${other.disqualifiedReasons.join("; ")}`,
    );
  }

  return { reasons, warnings };
}
