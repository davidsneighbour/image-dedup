import type { ImageRelationship } from "../domain/relationship.js";
import type { MultiScaleSsimResult, OrientationTransform } from "../matching/similarity.js";
import type { AlphaComparisonResult } from "./alpha-comparison.js";

export interface RelationshipContext {
  dimensionsMatch: boolean;
  formatsMatch: boolean;
  ssim: MultiScaleSsimResult;
  transformUsed: OrientationTransform;
  alpha: AlphaComparisonResult;
  meanColourDelta: number;
  ssimThreshold: number;
}

export interface ClassificationResult {
  relationship: ImageRelationship;
  confidence: number;
  reasons: string[];
  warnings: string[];
}

const COLOUR_ADJUSTED_DELTA_THRESHOLD = 15;
/** Distinguishes "recompression" (visibly different bytes) from "metadata-only-difference" (near-pixel-perfect). */
const METADATA_ONLY_SSIM_FLOOR = 0.999;

/**
 * Classifies the most likely relationship for a *confirmed* pair (PLAN.md
 * §15). Crop and watermark detection are out of scope here — crop
 * detection needs the dedicated subregion-matching work in M6, and
 * watermark detection is explicitly optional/conservative in the plan;
 * both are left as "unknown" for now rather than guessed at.
 *
 * Below the configured SSIM threshold, the pair is not confirmed at all:
 * relationship is "unknown" and the pair must not be forced into a group
 * (PLAN.md §35: "prefer manual-review... over a confident but unsupported
 * guess").
 */
export function classifyRelationship(ctx: RelationshipContext): ClassificationResult {
  const {
    ssim,
    transformUsed,
    alpha,
    meanColourDelta,
    ssimThreshold,
    dimensionsMatch,
    formatsMatch,
  } = ctx;
  const finestScale = ssim.scoresByScale.at(-1);

  if (ssim.score < ssimThreshold) {
    return {
      relationship: "unknown",
      confidence: Math.max(0, ssim.score),
      reasons: [],
      warnings: [
        `structural similarity (${ssim.score.toFixed(3)}) is below the configured threshold (${ssimThreshold})`,
      ],
    };
  }

  const reasons: string[] = [
    `structural similarity ${ssim.score.toFixed(3)}${finestScale ? ` at ${finestScale.scale}px` : ""}`,
  ];
  const warnings: string[] = [];
  let confidence = ssim.score;

  if (transformUsed !== "none") {
    reasons.push(`matched after applying ${transformUsed}`);
  }

  if (alpha.mismatch) {
    warnings.push("one candidate has meaningful transparency the other lacks");
    confidence -= 0.05;
  }

  const colourAdjusted = meanColourDelta > COLOUR_ADJUSTED_DELTA_THRESHOLD;
  if (colourAdjusted) {
    warnings.push(`mean colour channels differ by ${meanColourDelta.toFixed(1)} (0-255 scale)`);
  }

  let relationship: ImageRelationship;
  if (transformUsed === "rotate180") {
    relationship = "rotation";
  } else if (transformUsed === "flipHorizontal" || transformUsed === "flipVertical") {
    relationship = "mirrored";
  } else if (colourAdjusted) {
    relationship = "colour-adjusted";
  } else if (dimensionsMatch && formatsMatch) {
    relationship =
      ssim.score >= METADATA_ONLY_SSIM_FLOOR ? "metadata-only-difference" : "recompression";
  } else if (dimensionsMatch && !formatsMatch) {
    relationship = "format-conversion";
  } else if (!dimensionsMatch && formatsMatch) {
    relationship = "resize";
  } else {
    relationship = "resize-and-recompression";
  }

  return {
    relationship,
    confidence: Math.max(0, Math.min(1, confidence)),
    reasons,
    warnings,
  };
}
