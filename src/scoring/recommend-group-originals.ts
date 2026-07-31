import type { ImageOriginConfig } from "../config/schema.js";
import type { ImageGroup, ImageGroupStatus } from "../domain/image-group.js";
import type { ImageRecord } from "../domain/image-record.js";
import { computeRecommendationConfidence } from "./confidence.js";
import { explainRecommendation } from "./explain-score.js";
import {
  type CandidateScore,
  buildScoringContext,
  gatherMemberSignals,
  scoreCandidate,
} from "./score-candidate.js";

export interface RecommendGroupOriginalsOptions {
  scoring: ImageOriginConfig["scoring"];
  review: Pick<
    ImageOriginConfig["review"],
    "automaticConfidenceThreshold" | "manualReviewThreshold"
  >;
  pathPreferences: ImageOriginConfig["pathPreferences"];
}

/**
 * Scores every member of a "visual" group and, when confident enough,
 * recommends one as the original (PLAN.md §17, §18). Never touches
 * "exact-duplicate" groups — those are byte-identical, so there's no
 * quality to rank; M3 already handles their recommendation via path
 * preference alone.
 *
 * `status: "automatic"` and `recommendedOriginalId` are only ever set
 * together, and only when a non-disqualified candidate exists *and*
 * confidence clears `review.automaticConfidenceThreshold` — even a
 * high-scoring top candidate does not bypass the hard disqualifiers in
 * `scoreCandidate` (PLAN.md §17.1, §18.2: "even high confidence must not
 * bypass configured hard review rules"). Below that but above
 * `review.manualReviewThreshold`, a candidate may still be *suggested* in
 * `reasons` for a human reviewer, but `recommendedOriginalId` stays
 * unset — matches M3's precedent of only ever locking in a recommendation
 * for `status: "automatic"`.
 */
export async function recommendGroupOriginal(
  group: ImageGroup,
  recordsById: ReadonlyMap<string, ImageRecord>,
  options: RecommendGroupOriginalsOptions,
): Promise<ImageGroup> {
  if (group.kind !== "visual") {
    return group;
  }

  const memberRecords = group.members
    .map((id) => recordsById.get(id))
    .filter((record): record is ImageRecord => record !== undefined);
  if (memberRecords.length < 2) {
    return group;
  }

  const signals = await Promise.all(
    memberRecords.map((record) => gatherMemberSignals(record, group, options.pathPreferences)),
  );
  const context = buildScoringContext(signals);
  const scores: CandidateScore[] = signals.map((signal) =>
    scoreCandidate(signal, context, options.scoring.weights, options.scoring.penalties),
  );

  const eligibleByScore = scores
    .filter((score) => !score.disqualified)
    .sort((a, b) => b.total - a.total);
  const topEligible = eligibleByScore[0];

  const confidence = computeRecommendationConfidence(group.confidence, scores);

  let status: ImageGroupStatus;
  let recommendedOriginalId: string | undefined;
  let score: number | undefined;
  let reasons = group.reasons;
  let warnings = group.warnings;

  if (confidence < options.review.manualReviewThreshold) {
    status = "ambiguous";
  } else if (confidence >= options.review.automaticConfidenceThreshold && topEligible) {
    status = "automatic";
    recommendedOriginalId = topEligible.recordId;
    score = topEligible.total;
    const explanation = explainRecommendation(topEligible, scores, recordsById);
    reasons = [...new Set([...group.reasons, ...explanation.reasons])];
    warnings = [...new Set([...group.warnings, ...explanation.warnings])];
  } else {
    status = "manual-review";
    if (topEligible) {
      const path = recordsById.get(topEligible.recordId)?.relativePath ?? topEligible.recordId;
      const explanation = explainRecommendation(topEligible, scores, recordsById);
      reasons = [
        ...new Set([
          ...group.reasons,
          `possible candidate (not auto-selected): "${path}", score ${topEligible.total.toFixed(0)}/100`,
        ]),
      ];
      warnings = [...new Set([...group.warnings, ...explanation.warnings])];
    } else {
      warnings = [
        ...new Set([
          ...group.warnings,
          "no candidate was eligible for automatic selection (all members disqualified) — manual review required",
        ]),
      ];
    }
  }

  return {
    ...group,
    ...(recommendedOriginalId ? { recommendedOriginalId } : {}),
    ...(score !== undefined ? { score } : {}),
    confidence,
    status,
    reasons,
    warnings,
  };
}
