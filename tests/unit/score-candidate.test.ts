import { describe, expect, it } from "vitest";
import {
  type MemberSignals,
  buildScoringContext,
  scoreCandidate,
} from "../../src/scoring/score-candidate.js";

const WEIGHTS = {
  nativeDetail: 30,
  effectiveResolution: 20,
  completeness: 20,
  bitDepth: 5,
  alphaPreservation: 8,
  iccProfile: 5,
  usefulMetadata: 7,
  preferredSourcePath: 5,
};

const PENALTIES = {
  probableUpscale: 25,
  confirmedCrop: 20,
  missingAlphaAvailableElsewhere: 12,
  metadataStrippedRelativeToGroup: 2,
};

function signals(overrides: Partial<MemberSignals> & { recordId: string }): MemberSignals {
  return {
    detailScore: 50,
    pixelCount: 100_000,
    bitDepth: 8,
    hasAlpha: false,
    iccPresent: false,
    metadataCount: 0,
    pathPreferenceScore: 0,
    isCrop: false,
    isProbableUpscale: false,
    ...overrides,
  };
}

describe("buildScoringContext", () => {
  it("computes group maxima and flags from member signals", () => {
    const all = [
      signals({ recordId: "a", detailScore: 80, pixelCount: 500, bitDepth: 8, hasAlpha: true }),
      signals({
        recordId: "b",
        detailScore: 40,
        pixelCount: 200,
        bitDepth: 16,
        isCrop: true,
        cropRetainedArea: 0.7,
      }),
    ];
    const context = buildScoringContext(all);

    expect(context.maxDetailScore).toBe(80);
    expect(context.maxPixelCount).toBe(500);
    expect(context.maxBitDepth).toBe(16);
    expect(context.anyCompleteCandidateExists).toBe(true); // "a" is not a crop
    expect(context.anyOtherGenuineAlpha("b")).toBe(true); // "a" has alpha
    expect(context.anyOtherGenuineAlpha("a")).toBe(false); // only "a" itself has alpha
  });

  it("reports no complete candidate when every member is a crop", () => {
    const all = [
      signals({ recordId: "a", isCrop: true, cropRetainedArea: 0.8 }),
      signals({ recordId: "b", isCrop: true, cropRetainedArea: 0.6 }),
    ];
    expect(buildScoringContext(all).anyCompleteCandidateExists).toBe(false);
  });
});

describe("scoreCandidate", () => {
  it("gives the sharpest member of the group full native-detail marks", () => {
    const all = [
      signals({ recordId: "a", detailScore: 100 }),
      signals({ recordId: "b", detailScore: 50 }),
    ];
    const context = buildScoringContext(all);

    const scoreA = scoreCandidate(all[0]!, context, WEIGHTS, PENALTIES);
    const scoreB = scoreCandidate(all[1]!, context, WEIGHTS, PENALTIES);

    expect(scoreA.components.nativeDetail).toBeCloseTo(30, 5);
    expect(scoreB.components.nativeDetail).toBeCloseTo(15, 5);
    expect(scoreA.total).toBeGreaterThan(scoreB.total);
  });

  it("penalises and discounts a confirmed crop", () => {
    const all = [
      signals({ recordId: "full", pixelCount: 1000, detailScore: 50 }),
      signals({
        recordId: "crop",
        pixelCount: 1000,
        detailScore: 50,
        isCrop: true,
        cropRetainedArea: 0.5,
      }),
    ];
    const context = buildScoringContext(all);

    const cropScore = scoreCandidate(all[1]!, context, WEIGHTS, PENALTIES);

    expect(cropScore.penalties.confirmedCrop).toBe(PENALTIES.confirmedCrop);
    expect(cropScore.components.completeness).toBeCloseTo(WEIGHTS.completeness * 0.5, 5);
    expect(cropScore.components.effectiveResolution).toBeLessThan(WEIGHTS.effectiveResolution);
  });

  it("disqualifies a crop when a complete candidate exists in the group", () => {
    const all = [
      signals({ recordId: "full" }),
      signals({ recordId: "crop", isCrop: true, cropRetainedArea: 0.7 }),
    ];
    const context = buildScoringContext(all);
    const cropScore = scoreCandidate(all[1]!, context, WEIGHTS, PENALTIES);

    expect(cropScore.disqualified).toBe(true);
    expect(cropScore.disqualifiedReasons.some((r) => r.includes("crop"))).toBe(true);
  });

  it("does not disqualify a crop when no complete candidate exists (nothing better available)", () => {
    const all = [
      signals({ recordId: "crop1", isCrop: true, cropRetainedArea: 0.8 }),
      signals({ recordId: "crop2", isCrop: true, cropRetainedArea: 0.6 }),
    ];
    const context = buildScoringContext(all);
    const score = scoreCandidate(all[0]!, context, WEIGHTS, PENALTIES);

    expect(score.disqualified).toBe(false);
  });

  it("disqualifies a probable upscale when a genuine candidate exists", () => {
    const all = [
      signals({ recordId: "genuine" }),
      signals({ recordId: "upscaled", isProbableUpscale: true }),
    ];
    const context = buildScoringContext(all);
    const score = scoreCandidate(all[1]!, context, WEIGHTS, PENALTIES);

    expect(score.disqualified).toBe(true);
    expect(score.penalties.probableUpscale).toBe(PENALTIES.probableUpscale);
  });

  it("disqualifies missing alpha when another candidate has genuine transparency", () => {
    const all = [
      signals({ recordId: "transparent", hasAlpha: true }),
      signals({ recordId: "flattened", hasAlpha: false }),
    ];
    const context = buildScoringContext(all);
    const score = scoreCandidate(all[1]!, context, WEIGHTS, PENALTIES);

    expect(score.disqualified).toBe(true);
    expect(score.penalties.missingAlphaAvailableElsewhere).toBe(
      PENALTIES.missingAlphaAvailableElsewhere,
    );
  });

  it("does not penalise missing alpha when no group member has it either", () => {
    const all = [
      signals({ recordId: "a", hasAlpha: false }),
      signals({ recordId: "b", hasAlpha: false }),
    ];
    const context = buildScoringContext(all);
    const score = scoreCandidate(all[0]!, context, WEIGHTS, PENALTIES);

    expect(score.penalties.missingAlphaAvailableElsewhere).toBe(0);
    expect(score.disqualified).toBe(false);
  });

  it("scores bit depth proportionally to the group's maximum", () => {
    const all = [signals({ recordId: "a", bitDepth: 16 }), signals({ recordId: "b", bitDepth: 8 })];
    const context = buildScoringContext(all);
    const scoreB = scoreCandidate(all[1]!, context, WEIGHTS, PENALTIES);

    expect(scoreB.components.bitDepth).toBeCloseTo(WEIGHTS.bitDepth * 0.5, 5);
  });

  it("rewards a preferred source path and penalises a deprioritised one", () => {
    const all = [
      signals({ recordId: "preferred", pathPreferenceScore: 20 }),
      signals({ recordId: "deprioritised", pathPreferenceScore: -20 }),
      signals({ recordId: "neutral", pathPreferenceScore: 0 }),
    ];
    const context = buildScoringContext(all);

    const preferred = scoreCandidate(all[0]!, context, WEIGHTS, PENALTIES);
    const deprioritised = scoreCandidate(all[1]!, context, WEIGHTS, PENALTIES);
    const neutral = scoreCandidate(all[2]!, context, WEIGHTS, PENALTIES);

    expect(preferred.components.preferredSourcePath).toBe(WEIGHTS.preferredSourcePath);
    expect(deprioritised.components.preferredSourcePath).toBe(0);
    expect(neutral.components.preferredSourcePath).toBe(WEIGHTS.preferredSourcePath / 2);
  });

  it("penalises metadata stripped relative to a group peer", () => {
    const all = [
      signals({ recordId: "a", metadataCount: 3 }),
      signals({ recordId: "b", metadataCount: 0 }),
    ];
    const context = buildScoringContext(all);
    const scoreB = scoreCandidate(all[1]!, context, WEIGHTS, PENALTIES);

    expect(scoreB.penalties.metadataStrippedRelativeToGroup).toBe(
      PENALTIES.metadataStrippedRelativeToGroup,
    );
  });

  it("never produces a total outside [0, 100]", () => {
    const all = [
      signals({
        recordId: "worst",
        detailScore: 1,
        pixelCount: 10,
        isCrop: true,
        cropRetainedArea: 0.1,
        isProbableUpscale: true,
        hasAlpha: false,
      }),
      signals({ recordId: "best", detailScore: 100, pixelCount: 100_000, hasAlpha: true }),
    ];
    const context = buildScoringContext(all);
    const worst = scoreCandidate(all[0]!, context, WEIGHTS, PENALTIES);
    const best = scoreCandidate(all[1]!, context, WEIGHTS, PENALTIES);

    expect(worst.total).toBeGreaterThanOrEqual(0);
    expect(worst.total).toBeLessThanOrEqual(100);
    expect(best.total).toBeGreaterThanOrEqual(0);
    expect(best.total).toBeLessThanOrEqual(100);
    expect(best.total).toBeGreaterThan(worst.total);
  });
});
