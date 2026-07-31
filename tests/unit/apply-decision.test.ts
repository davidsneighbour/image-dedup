import { describe, expect, it } from "vitest";
import type { ImageGroup } from "../../src/domain/image-group.js";
import type { ReviewDecision } from "../../src/domain/review-decision.js";
import { applyDecisionToGroup } from "../../src/review/apply-decision.js";

function group(overrides: Partial<ImageGroup> = {}): ImageGroup {
  return {
    id: "grp_1",
    kind: "visual",
    members: ["img_a", "img_b"],
    comparisons: [],
    recommendedOriginalId: "img_a",
    score: 88,
    confidence: 0.99,
    status: "automatic",
    reasons: ["img_a has more native detail"],
    warnings: [],
    ...overrides,
  };
}

function decision(overrides: Partial<ReviewDecision>): ReviewDecision {
  return {
    groupId: "grp_1",
    action: "approve-recommendation",
    selectedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("applyDecisionToGroup", () => {
  it("approve-recommendation: marks approved, keeps the recommendation and score", () => {
    const result = applyDecisionToGroup(group(), decision({ selectedImageId: "img_a" }));
    expect(result.status).toBe("approved");
    expect(result.recommendedOriginalId).toBe("img_a");
    expect(result.score).toBe(88);
  });

  it("select-different: switches the original, clears the now-inaccurate score", () => {
    const result = applyDecisionToGroup(
      group(),
      decision({ action: "select-different", selectedImageId: "img_b", note: "b has EXIF" }),
    );
    expect(result.status).toBe("approved");
    expect(result.recommendedOriginalId).toBe("img_b");
    expect(result.score).toBeUndefined();
  });

  it("select-different: throws if selectedImageId is missing (should have been caught by validation)", () => {
    expect(() => applyDecisionToGroup(group(), decision({ action: "select-different" }))).toThrow();
  });

  it("keep-multiple: approves without a single recommended original", () => {
    const result = applyDecisionToGroup(group(), decision({ action: "keep-multiple" }));
    expect(result.status).toBe("approved");
    expect(result.recommendedOriginalId).toBeUndefined();
    expect(result.score).toBeUndefined();
  });

  it("not-related: rejects the grouping and clears the recommendation", () => {
    const result = applyDecisionToGroup(group(), decision({ action: "not-related" }));
    expect(result.status).toBe("rejected");
    expect(result.recommendedOriginalId).toBeUndefined();
    expect(result.score).toBeUndefined();
  });

  it("defer: leaves status, recommendation, and score untouched", () => {
    const base = group({ status: "manual-review" });
    const {
      recommendedOriginalId: _recommendedOriginalId,
      score: _score,
      ...noRecommendation
    } = base;
    const result = applyDecisionToGroup(
      noRecommendation,
      decision({ action: "defer", note: "need a second opinion" }),
    );
    expect(result.status).toBe("manual-review");
    expect(result.recommendedOriginalId).toBeUndefined();
  });

  it("appends a human-readable review reason, including the note when present", () => {
    const result = applyDecisionToGroup(
      group(),
      decision({ selectedImageId: "img_a", note: "looks right" }),
    );
    expect(result.reasons.at(-1)).toBe("Reviewed by human: approve-recommendation — looks right");
    // Original automatic-scoring reasons are preserved, not replaced.
    expect(result.reasons[0]).toBe("img_a has more native detail");
  });
});
