import { describe, expect, it } from "vitest";
import type { ImageGroup } from "../../src/domain/image-group.js";
import type { ReviewDecision } from "../../src/domain/review-decision.js";
import { validateDecisions } from "../../src/review/validate-decisions.js";

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
    reasons: [],
    warnings: [],
    ...overrides,
  };
}

function decision(overrides: Partial<ReviewDecision>): ReviewDecision {
  return {
    groupId: "grp_1",
    action: "approve-recommendation",
    selectedAt: "2026-08-01T00:00:00.000Z",
    selectedImageId: "img_a",
    ...overrides,
  };
}

describe("validateDecisions", () => {
  it("accepts a decision whose group is unchanged between snapshot and live state", () => {
    const snapshot = new Map([["grp_1", group()]]);
    const live = new Map([["grp_1", group()]]);

    const result = validateDecisions([decision({})], snapshot, live);

    expect(result.valid).toEqual([decision({})]);
    expect(result.invalid).toEqual([]);
    expect(result.stale).toEqual([]);
  });

  it("rejects a decision for a group ID that doesn't exist in the reference snapshot", () => {
    const result = validateDecisions([decision({ groupId: "grp_missing" })], new Map(), new Map());

    expect(result.valid).toEqual([]);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0]?.reason).toMatch(/does not exist/);
  });

  it("rejects a selectedImageId that isn't a member of the group", () => {
    const snapshot = new Map([["grp_1", group()]]);
    const result = validateDecisions(
      [decision({ action: "select-different", selectedImageId: "img_z" })],
      snapshot,
      snapshot,
    );

    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0]?.reason).toMatch(/not a member/);
  });

  it("rejects approve-recommendation that doesn't select the group's actual recommendation", () => {
    const snapshot = new Map([["grp_1", group({ recommendedOriginalId: "img_a" })]]);
    const result = validateDecisions([decision({ selectedImageId: "img_b" })], snapshot, snapshot);

    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0]?.reason).toMatch(/recommended original/);
  });

  it("rejects conflicting duplicate decisions for the same group in one batch", () => {
    const snapshot = new Map([["grp_1", group()]]);
    const decisions = [
      decision({}),
      decision({ action: "not-related", selectedImageId: undefined }),
    ];

    const result = validateDecisions(decisions, snapshot, snapshot);

    expect(result.valid).toEqual([]);
    expect(result.invalid).toHaveLength(2);
    expect(result.invalid.every((issue) => issue.reason.includes("conflicting"))).toBe(true);
  });

  it("flags staleness when the live group's membership no longer matches the snapshot", () => {
    const snapshot = new Map([["grp_1", group({ members: ["img_a", "img_b"] })]]);
    const live = new Map([["grp_1", group({ members: ["img_a", "img_b", "img_c"] })]]);

    const result = validateDecisions([decision({})], snapshot, live);

    expect(result.valid).toEqual([]);
    expect(result.stale).toHaveLength(1);
    expect(result.stale[0]?.reason).toMatch(/membership has changed/);
  });

  it("flags staleness when the group no longer exists live at all", () => {
    const snapshot = new Map([["grp_1", group()]]);
    const result = validateDecisions([decision({})], snapshot, new Map());

    expect(result.stale).toHaveLength(1);
    expect(result.stale[0]?.reason).toMatch(/no longer exists/);
  });

  it("is order-independent for membership comparison (same members, different order, is not stale)", () => {
    const snapshot = new Map([["grp_1", group({ members: ["img_a", "img_b"] })]]);
    const live = new Map([["grp_1", group({ members: ["img_b", "img_a"] })]]);

    const result = validateDecisions([decision({})], snapshot, live);

    expect(result.stale).toEqual([]);
    expect(result.valid).toHaveLength(1);
  });

  it("re-checking against live-as-both-maps trivially satisfies staleness (the forced re-check pattern)", () => {
    const live = new Map([["grp_1", group({ members: ["img_a", "img_b", "img_c"] })]]);

    const result = validateDecisions([decision({})], live, live);

    expect(result.stale).toEqual([]);
    expect(result.valid).toHaveLength(1);
  });
});
