import pLimit from "p-limit";
import { detectCrop } from "../analysis/crop-detection.js";
import { detectProbableUpscale } from "../analysis/upscale-detection.js";
import type { ImageRecord } from "../domain/image-record.js";
import type { ConfirmedComparison } from "./confirm-candidates.js";
import { generateCropCandidatePairs } from "./crop-candidates.js";

export interface DetectCropsAndUpscalesOptions {
  detectCrops: boolean;
  detectUpscaling: boolean;
  concurrency: number;
}

export interface DetectCropsAndUpscalesResult {
  comparisons: ConfirmedComparison[];
  /** Records whose `quality.probableUpscale` changed and need re-persisting. */
  updatedRecords: ImageRecord[];
  cropsDetected: number;
  probableUpscalesDetected: number;
}

/** Only worth asking "is this an upscale" when one side has meaningfully more pixels than the other. */
const MIN_AREA_RATIO_FOR_UPSCALE_CHECK = 1.2;

function pairKey(a: string, b: string): string {
  return a < b ? `${a} ${b}` : `${b} ${a}`;
}

function placeholderComparison(a: string, b: string): ConfirmedComparison {
  return {
    a,
    b,
    relationship: "unknown",
    confidence: 0,
    ssimScore: 0,
    transformUsed: "none",
    reasons: [],
    warnings: [],
  };
}

/**
 * Crop detection (PLAN.md §12) re-examines every pair classified
 * "unknown" — both the ones M5 already produced (M4 candidates that
 * failed SSIM confirmation) and a dedicated, wider dHash-only candidate
 * search (`generateCropCandidatePairs`) added specifically because
 * cropping removes real content, a bigger perceptual change than M4's
 * tight threshold is tuned for. That wider search still isn't
 * aspect-ratio-independent (see its own doc comment) — a crop with a very
 * different aspect ratio than its source can still be missed. That's a
 * deliberate, documented scope limit, not an oversight; see RESTART.md.
 *
 * Probable-upscale detection (PLAN.md §13) runs on pairs M5 *did* confirm
 * where one image has meaningfully more pixels than the other — it only
 * ever adds a signal (`ImageRecord.quality.probableUpscale`) and a
 * warning; PLAN.md §13.3 requires a "substantial ranking penalty," but
 * actually scoring/ranking candidates is M7's job. This milestone's
 * responsibility ends at detecting and recording the signal.
 */
export async function detectCropsAndUpscales(
  comparisons: readonly ConfirmedComparison[],
  allRecords: readonly ImageRecord[],
  recordsById: ReadonlyMap<string, ImageRecord>,
  options: DetectCropsAndUpscalesOptions,
): Promise<DetectCropsAndUpscalesResult> {
  const limit = pLimit(options.concurrency);
  const updatedRecords = new Map<string, ImageRecord>();
  let cropsDetected = 0;
  let probableUpscalesDetected = 0;

  let workingComparisons = comparisons;
  if (options.detectCrops) {
    const existingKeys = new Set(workingComparisons.map((c) => pairKey(c.a, c.b)));
    const extraPairs = generateCropCandidatePairs(allRecords).filter(
      (pair) => !existingKeys.has(pairKey(pair.a, pair.b)),
    );
    if (extraPairs.length > 0) {
      workingComparisons = [
        ...workingComparisons,
        ...extraPairs.map((pair) => placeholderComparison(pair.a, pair.b)),
      ];
    }
  }

  const results = await Promise.all(
    workingComparisons.map((comparison) =>
      limit(async (): Promise<ConfirmedComparison> => {
        const recordA = recordsById.get(comparison.a);
        const recordB = recordsById.get(comparison.b);
        if (!recordA || !recordB) {
          return comparison;
        }

        let current = comparison;

        if (options.detectCrops && current.relationship === "unknown") {
          const crop = await detectCrop(
            {
              id: recordA.id,
              realPath: recordA.realPath,
              width: recordA.image.width,
              height: recordA.image.height,
            },
            {
              id: recordB.id,
              realPath: recordB.realPath,
              width: recordB.image.width,
              height: recordB.image.height,
            },
          );
          if (crop) {
            cropsDetected++;
            current = {
              ...current,
              relationship: "crop",
              confidence: crop.confidence,
              reasons: [
                `probable crop: ${(crop.retainedArea * 100).toFixed(0)}% of the larger image retained (confidence ${crop.confidence.toFixed(2)})`,
              ],
              warnings: [
                ...current.warnings,
                "detected as a crop — the full uncropped image should normally be preferred as the archival source, but the crop itself is preserved and must not be discarded automatically",
              ],
              details: {
                largerImageId: crop.largerImageId,
                croppedImageId: crop.croppedImageId,
                retainedArea: crop.retainedArea,
                cropBox: crop.cropBox,
              },
            };
          } else if (current.reasons.length === 0 && current.warnings.length === 0) {
            // A placeholder from the wider crop-only candidate search
            // (generateCropCandidatePairs) that never went through SSIM —
            // record *why* it's still "unknown" rather than leaving it
            // unexplained (PLAN.md's "uncertain pairs are labelled rather
            // than forced" applies to labelling with a reason, not just a
            // bare status).
            current = {
              ...current,
              warnings: [
                "considered as a possible crop (wider candidate search) but no confident crop region was found",
              ],
            };
          }
        }

        if (options.detectUpscaling && current.relationship !== "unknown") {
          const areaA = recordA.image.width * recordA.image.height;
          const areaB = recordB.image.width * recordB.image.height;
          const [largerRecord, smallerRecord] =
            areaA >= areaB ? [recordA, recordB] : [recordB, recordA];
          const areaRatio = Math.max(areaA, areaB) / Math.max(1, Math.min(areaA, areaB));

          if (areaRatio >= MIN_AREA_RATIO_FOR_UPSCALE_CHECK) {
            const upscale = await detectProbableUpscale(
              {
                realPath: largerRecord.realPath,
                width: largerRecord.image.width,
                height: largerRecord.image.height,
              },
              {
                realPath: smallerRecord.realPath,
                width: smallerRecord.image.width,
                height: smallerRecord.image.height,
              },
            );

            if (upscale.probableUpscale) {
              probableUpscalesDetected++;
              const existing = updatedRecords.get(largerRecord.id) ?? largerRecord;
              updatedRecords.set(largerRecord.id, {
                ...existing,
                quality: {
                  ...existing.quality,
                  probableUpscale: true,
                  detailScore: upscale.largerDetailScore,
                },
              });
              current = {
                ...current,
                warnings: [
                  ...current.warnings,
                  `the larger image (${largerRecord.relativePath}) shows no measurable extra detail over the smaller candidate upscaled to match — probable upscale, not a genuine higher-resolution source`,
                ],
              };
            }
          }
        }

        return current;
      }),
    ),
  );

  return {
    comparisons: results,
    updatedRecords: [...updatedRecords.values()],
    cropsDetected,
    probableUpscalesDetected,
  };
}
