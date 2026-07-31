import { describe, expect, it } from "vitest";
import { buildVisualGroups } from "../../src/matching/build-visual-groups.js";
import type { ConfirmedComparison } from "../../src/matching/confirm-candidates.js";

function edge(
  a: string,
  b: string,
  overrides: Partial<ConfirmedComparison> = {},
): ConfirmedComparison {
  return {
    a,
    b,
    relationship: "resize",
    confidence: 0.9,
    ssimScore: 0.97,
    transformUsed: "none",
    reasons: ["structural similarity 0.970"],
    warnings: [],
    ...overrides,
  };
}

const REVIEW_CONFIG = { manualReviewThreshold: 0.7 };

describe("buildVisualGroups", () => {
  it("groups a fully-connected clique into one group", () => {
    const comparisons = [edge("a", "b"), edge("a", "c"), edge("b", "c")];
    const groups = buildVisualGroups(comparisons, REVIEW_CONFIG);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.members).toEqual(["a", "b", "c"]);
    expect(groups[0]?.kind).toBe("visual");
  });

  it("excludes a transitively-related member that has no direct edge to the representative", () => {
    // a-b and b-c confirmed, but a-c never compared (or not confirmed):
    // the weak-chain risk PLAN.md §16.1 warns about. "a" is representative
    // (sorts first); "c" has no direct edge to "a" and must not be forced in.
    const comparisons = [edge("a", "b"), edge("b", "c")];
    const groups = buildVisualGroups(comparisons, REVIEW_CONFIG);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.members).toEqual(["a", "b"]);
    expect(groups[0]?.warnings.some((w) => w.includes("c"))).toBe(true);
  });

  it("never sets recommendedOriginalId or status 'automatic' (that's M7's job)", () => {
    const comparisons = [edge("a", "b", { confidence: 1 })];
    const groups = buildVisualGroups(comparisons, REVIEW_CONFIG);

    expect(groups[0]?.recommendedOriginalId).toBeUndefined();
    expect(groups[0]?.status).not.toBe("automatic");
  });

  it("marks a group 'ambiguous' when confidence is below the manual-review threshold", () => {
    const comparisons = [edge("a", "b", { confidence: 0.5 })];
    const groups = buildVisualGroups(comparisons, REVIEW_CONFIG);
    expect(groups[0]?.status).toBe("ambiguous");
  });

  it("marks a group 'manual-review' when confidence meets the threshold", () => {
    const comparisons = [edge("a", "b", { confidence: 0.9 })];
    const groups = buildVisualGroups(comparisons, REVIEW_CONFIG);
    expect(groups[0]?.status).toBe("manual-review");
  });

  it("uses the minimum edge confidence for the group (weakest link)", () => {
    const comparisons = [edge("a", "b", { confidence: 0.95 }), edge("a", "c", { confidence: 0.8 })];
    const groups = buildVisualGroups(comparisons, REVIEW_CONFIG);
    expect(groups[0]?.confidence).toBe(0.8);
  });

  it("excludes unconfirmed ('unknown') relationships from grouping entirely", () => {
    const comparisons = [edge("a", "b", { relationship: "unknown" })];
    const groups = buildVisualGroups(comparisons, REVIEW_CONFIG);
    expect(groups).toHaveLength(0);
  });

  it("produces separate groups for disconnected components", () => {
    const comparisons = [edge("a", "b"), edge("x", "y")];
    const groups = buildVisualGroups(comparisons, REVIEW_CONFIG);
    expect(groups).toHaveLength(2);
    const memberSets = groups.map((g) => g.members.sort().join(","));
    expect(memberSets.sort()).toEqual(["a,b", "x,y"]);
  });

  it("produces deterministic group ids regardless of input order", () => {
    const comparisons = [edge("a", "b"), edge("a", "c")];
    const forward = buildVisualGroups(comparisons, REVIEW_CONFIG);
    const reversed = buildVisualGroups([...comparisons].reverse(), REVIEW_CONFIG);
    expect(forward[0]?.id).toBe(reversed[0]?.id);
  });
});
