import pLimit from "p-limit";
import { compareAlpha } from "../analysis/alpha-comparison.js";
import { meanColourDelta } from "../analysis/colour-comparison.js";
import { classifyRelationship } from "../analysis/relationship-classifier.js";
import type { PerceptualCandidatePair } from "../domain/candidate-pair.js";
import type { ImageRecord } from "../domain/image-record.js";
import type { ImageRelationship } from "../domain/relationship.js";
import { type OrientationTransform, compareAtScale, compareMultiScale } from "./similarity.js";

export interface ConfirmedComparison {
  a: string;
  b: string;
  relationship: ImageRelationship;
  confidence: number;
  ssimScore: number;
  transformUsed: OrientationTransform;
  reasons: string[];
  warnings: string[];
  /** Relationship-specific structured data (e.g. a crop's `cropBox`/`retainedArea`), added by whichever detector produced it. */
  details?: Record<string, unknown>;
}

const ROTATION_MIRROR_TRANSFORMS: readonly OrientationTransform[] = [
  "rotate180",
  "flipHorizontal",
  "flipVertical",
];
const ROTATION_MIRROR_PROBE_SCALE = 256;

export interface ConfirmCandidatesOptions {
  ssimThreshold: number;
  /** Gates the rotation/mirror fallback (PLAN.md §11.3, §35's "avoid unnecessary work" spirit — matches config.matching.detectRotation). */
  detectRotation: boolean;
  concurrency: number;
}

/**
 * Confirms every M4 candidate pair via SSIM (PLAN.md §11) and classifies
 * its relationship (§15). A hash match is only a candidate signal (§10.2)
 * — this is where that gets checked against actual pixel content.
 *
 * Rotation/mirror checks (§11.3) are only attempted for pairs that are
 * already candidates (the "initial candidate score" that justifies the
 * extra expense) and whose plain-orientation SSIM didn't confirm — not as
 * a blanket transform search over every pair.
 */
export async function confirmCandidatePairs(
  pairs: readonly PerceptualCandidatePair[],
  recordsById: ReadonlyMap<string, ImageRecord>,
  options: ConfirmCandidatesOptions,
): Promise<ConfirmedComparison[]> {
  const limit = pLimit(options.concurrency);

  const results = await Promise.all(
    pairs.map((pair) =>
      limit(async (): Promise<ConfirmedComparison | undefined> => {
        const recordA = recordsById.get(pair.a);
        const recordB = recordsById.get(pair.b);
        if (!recordA || !recordB) {
          return undefined;
        }

        let ssimResult = await compareMultiScale(recordA.realPath, recordB.realPath, {
          widthA: recordA.image.width,
          heightA: recordA.image.height,
          widthB: recordB.image.width,
          heightB: recordB.image.height,
        });
        let transformUsed: OrientationTransform = "none";

        if (ssimResult.score < options.ssimThreshold && options.detectRotation) {
          for (const transform of ROTATION_MIRROR_TRANSFORMS) {
            const transformedScore = await compareAtScale(
              recordA.realPath,
              recordB.realPath,
              ROTATION_MIRROR_PROBE_SCALE,
              transform,
            );
            if (transformedScore > ssimResult.score) {
              ssimResult = {
                score: transformedScore,
                scoresByScale: [{ scale: ROTATION_MIRROR_PROBE_SCALE, score: transformedScore }],
              };
              transformUsed = transform;
            }
          }
        }

        const [alpha, colourDelta] = await Promise.all([
          compareAlpha(
            recordA.realPath,
            recordA.image.hasAlpha,
            recordB.realPath,
            recordB.image.hasAlpha,
          ),
          meanColourDelta(recordA.realPath, recordB.realPath),
        ]);

        const classification = classifyRelationship({
          dimensionsMatch:
            recordA.image.width === recordB.image.width &&
            recordA.image.height === recordB.image.height,
          formatsMatch: recordA.image.format === recordB.image.format,
          ssim: ssimResult,
          transformUsed,
          alpha,
          meanColourDelta: colourDelta,
          ssimThreshold: options.ssimThreshold,
        });

        return {
          a: pair.a,
          b: pair.b,
          relationship: classification.relationship,
          confidence: classification.confidence,
          ssimScore: ssimResult.score,
          transformUsed,
          reasons: classification.reasons,
          warnings: classification.warnings,
        };
      }),
    ),
  );

  const confirmed = results.filter((result): result is ConfirmedComparison => result !== undefined);
  confirmed.sort((x, y) => x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
  return confirmed;
}
