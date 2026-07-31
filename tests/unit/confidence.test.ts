import { describe, expect, it } from "vitest";
import { computeRecommendationConfidence } from "../../src/scoring/confidence.js";
import type { CandidateScore } from "../../src/scoring/score-candidate.js";

function candidateScore(
  overrides: Partial<CandidateScore> & { recordId: string; total: number },
): CandidateScore {
  return {
    components: {
      nativeDetail: 0,
      effectiveResolution: 0,
      completeness: 0,
      bitDepth: 0,
      alphaPreservation: 0,
      iccProfile: 0,
      usefulMetadata: 0,
      preferredSourcePath: 0,
    },
    penalties: {
      probableUpscale: 0,
      confirmedCrop: 0,
      missingAlphaAvailableElsewhere: 0,
      metadataStrippedRelativeToGroup: 0,
    },
    reasons: [],
    warnings: [],
    disqualified: false,
    disqualifiedReasons: [],
    ...overrides,
  };
}

describe("computeRecommendationConfidence", () => {
  it("boosts confidence when one candidate clearly exceeds the others", () => {
    const scores = [
      candidateScore({ recordId: "a", total: 95 }),
      candidateScore({ recordId: "b", total: 60 }),
    ];
    const confidence = computeRecommendationConfidence(0.9, scores);
    expect(confidence).toBeGreaterThan(0.9);
  });

  it("reduces confidence when the top two scores are close", () => {
    const scores = [
      candidateScore({ recordId: "a", total: 80 }),
      candidateScore({ recordId: "b", total: 78 }),
    ];
    const confidence = computeRecommendationConfidence(0.9, scores);
    expect(confidence).toBeLessThan(0.9);
  });

  it("reduces confidence when a crop is present in the group", () => {
    const scores = [
      candidateScore({ recordId: "a", total: 95 }),
      candidateScore({
        recordId: "b",
        total: 40,
        penalties: {
          probableUpscale: 0,
          confirmedCrop: 20,
          missingAlphaAvailableElsewhere: 0,
          metadataStrippedRelativeToGroup: 0,
        },
      }),
    ];
    const withCrop = computeRecommendationConfidence(0.9, scores);

    const scoresNoCrop = [
      candidateScore({ recordId: "a", total: 95 }),
      candidateScore({ recordId: "b", total: 40 }),
    ];
    const withoutCrop = computeRecommendationConfidence(0.9, scoresNoCrop);

    expect(withCrop).toBeLessThan(withoutCrop);
  });

  it("stays within [0, 1]", () => {
    const scores = [
      candidateScore({ recordId: "a", total: 100 }),
      candidateScore({ recordId: "b", total: 0 }),
    ];
    expect(computeRecommendationConfidence(1, scores)).toBeLessThanOrEqual(1);
    expect(computeRecommendationConfidence(0, scores)).toBeGreaterThanOrEqual(0);
  });

  it("returns the base confidence unchanged for a single-candidate group", () => {
    const scores = [candidateScore({ recordId: "a", total: 80 })];
    expect(computeRecommendationConfidence(0.85, scores)).toBeCloseTo(0.85, 5);
  });
});
