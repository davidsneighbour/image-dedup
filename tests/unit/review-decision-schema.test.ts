import { describe, expect, it } from "vitest";
import { reviewDecisionsSchema } from "../../src/domain/review-decision.js";

describe("reviewDecisionSchema", () => {
  it("accepts a valid approve-recommendation decision", () => {
    const result = reviewDecisionsSchema.safeParse([
      {
        groupId: "grp_1",
        selectedImageId: "img_a",
        action: "approve-recommendation",
        selectedAt: "2026-07-31T00:00:00.000Z",
      },
    ]);
    expect(result.success).toBe(true);
  });

  it("accepts a defer decision with no selectedImageId", () => {
    const result = reviewDecisionsSchema.safeParse([
      { groupId: "grp_1", action: "defer", selectedAt: "2026-07-31T00:00:00.000Z", note: "later" },
    ]);
    expect(result.success).toBe(true);
  });

  it("rejects select-different without a selectedImageId", () => {
    const result = reviewDecisionsSchema.safeParse([
      { groupId: "grp_1", action: "select-different", selectedAt: "2026-07-31T00:00:00.000Z" },
    ]);
    expect(result.success).toBe(false);
  });

  it("rejects an unknown action", () => {
    const result = reviewDecisionsSchema.safeParse([
      { groupId: "grp_1", action: "auto-delete", selectedAt: "2026-07-31T00:00:00.000Z" },
    ]);
    expect(result.success).toBe(false);
  });

  it("rejects unknown extra properties", () => {
    const result = reviewDecisionsSchema.safeParse([
      {
        groupId: "grp_1",
        action: "defer",
        selectedAt: "2026-07-31T00:00:00.000Z",
        extra: "nope",
      },
    ]);
    expect(result.success).toBe(false);
  });
});
