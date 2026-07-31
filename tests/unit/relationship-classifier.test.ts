import { describe, expect, it } from "vitest";
import {
  type RelationshipContext,
  classifyRelationship,
} from "../../src/analysis/relationship-classifier.js";
import type { MultiScaleSsimResult } from "../../src/matching/similarity.js";

function ssimResult(score: number, scale = 256): MultiScaleSsimResult {
  return { score, scoresByScale: [{ scale, score }] };
}

function baseContext(overrides: Partial<RelationshipContext> = {}): RelationshipContext {
  return {
    dimensionsMatch: true,
    formatsMatch: true,
    ssim: ssimResult(0.98),
    transformUsed: "none",
    alpha: { aHasMeaningfulAlpha: false, bHasMeaningfulAlpha: false, mismatch: false },
    meanColourDelta: 2,
    ssimThreshold: 0.96,
    ...overrides,
  };
}

describe("classifyRelationship", () => {
  it("classifies below-threshold pairs as unknown and does not force a relationship", () => {
    const result = classifyRelationship(baseContext({ ssim: ssimResult(0.5) }));
    expect(result.relationship).toBe("unknown");
    expect(result.warnings[0]).toMatch(/below the configured threshold/);
  });

  it("classifies same dimensions + same format + near-perfect SSIM as metadata-only-difference", () => {
    const result = classifyRelationship(
      baseContext({ dimensionsMatch: true, formatsMatch: true, ssim: ssimResult(0.9995) }),
    );
    expect(result.relationship).toBe("metadata-only-difference");
  });

  it("classifies same dimensions + same format + high (not near-perfect) SSIM as recompression", () => {
    const result = classifyRelationship(
      baseContext({ dimensionsMatch: true, formatsMatch: true, ssim: ssimResult(0.97) }),
    );
    expect(result.relationship).toBe("recompression");
  });

  it("classifies same dimensions + different format as format-conversion", () => {
    const result = classifyRelationship(
      baseContext({ dimensionsMatch: true, formatsMatch: false }),
    );
    expect(result.relationship).toBe("format-conversion");
  });

  it("classifies different dimensions + same format as resize", () => {
    const result = classifyRelationship(
      baseContext({ dimensionsMatch: false, formatsMatch: true }),
    );
    expect(result.relationship).toBe("resize");
  });

  it("classifies different dimensions + different format as resize-and-recompression", () => {
    const result = classifyRelationship(
      baseContext({ dimensionsMatch: false, formatsMatch: false }),
    );
    expect(result.relationship).toBe("resize-and-recompression");
  });

  it("classifies a rotate180 match as rotation", () => {
    const result = classifyRelationship(baseContext({ transformUsed: "rotate180" }));
    expect(result.relationship).toBe("rotation");
  });

  it("classifies a flip match as mirrored", () => {
    const resultH = classifyRelationship(baseContext({ transformUsed: "flipHorizontal" }));
    expect(resultH.relationship).toBe("mirrored");
    const resultV = classifyRelationship(baseContext({ transformUsed: "flipVertical" }));
    expect(resultV.relationship).toBe("mirrored");
  });

  it("classifies a large mean colour delta as colour-adjusted, overriding dimension/format-based rules", () => {
    const result = classifyRelationship(
      baseContext({ dimensionsMatch: true, formatsMatch: true, meanColourDelta: 40 }),
    );
    expect(result.relationship).toBe("colour-adjusted");
  });

  it("reduces confidence and warns when alpha transparency mismatches", () => {
    const withMismatch = classifyRelationship(
      baseContext({
        alpha: { aHasMeaningfulAlpha: true, bHasMeaningfulAlpha: false, mismatch: true },
      }),
    );
    const withoutMismatch = classifyRelationship(baseContext());
    expect(withMismatch.confidence).toBeLessThan(withoutMismatch.confidence);
    expect(withMismatch.warnings.some((w) => w.includes("transparency"))).toBe(true);
  });

  it("keeps confidence within [0, 1]", () => {
    const result = classifyRelationship(baseContext({ ssim: ssimResult(1) }));
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });
});
