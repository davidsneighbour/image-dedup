import { describe, expect, it } from "vitest";
import { configSchema } from "../../src/config/schema.js";

describe("configSchema", () => {
  it("applies documented defaults for a minimal config", () => {
    const result = configSchema.parse({ inputs: ["./public"] });

    expect(result.workspace).toBe("./.image-origin");
    expect(result.include).toEqual(["**/*.{jpg,jpeg,png,webp,avif,gif}"]);
    expect(result.matching.perceptualDistanceThreshold).toBe(10);
    expect(result.review.automaticConfidenceThreshold).toBe(0.97);
    expect(result.review.manualReviewThreshold).toBe(0.7);
    expect(result.consolidation.collisionPolicy).toBe("fail");
    expect(result.consolidation.copyInsteadOfMove).toBe(true);
  });

  it("rejects a config with no input directories", () => {
    expect(configSchema.safeParse({ inputs: [] }).success).toBe(false);
  });

  it("rejects unknown top-level keys", () => {
    const result = configSchema.safeParse({ inputs: ["./public"], notARealOption: true });
    expect(result.success).toBe(false);
  });

  it("rejects manualReviewThreshold above automaticConfidenceThreshold", () => {
    const result = configSchema.safeParse({
      inputs: ["./public"],
      review: { manualReviewThreshold: 0.99, automaticConfidenceThreshold: 0.9 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects disabling copyInsteadOfMove (moving/deleting sources is out of scope)", () => {
    const result = configSchema.safeParse({
      inputs: ["./public"],
      consolidation: { copyInsteadOfMove: false },
    });
    expect(result.success).toBe(false);
  });

  it("requires a template when naming strategy is 'template'", () => {
    const result = configSchema.safeParse({
      inputs: ["./public"],
      consolidation: { naming: "template" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts a template naming strategy with a template string", () => {
    const result = configSchema.safeParse({
      inputs: ["./public"],
      consolidation: { naming: "template", template: "{year}/{slug}-{shortHash}.{ext}" },
    });
    expect(result.success).toBe(true);
  });
});
