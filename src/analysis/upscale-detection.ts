import sharp from "sharp";
import { compareAtScale } from "../matching/similarity.js";

/** Analysis size is capped so this stays cheap even for very large source images. */
const MAX_ANALYSIS_DIMENSION = 512;
/** Below this, the two images aren't similar enough for "upscale" to even be the right question — that's a job for the relationship classifier, not this detector. */
const MIN_DOWNSCALED_SIMILARITY = 0.9;
/**
 * If the larger image's high-frequency detail is less than this multiple
 * of naively-upscaled-smaller's detail, the larger image isn't
 * demonstrating genuine extra resolution (PLAN.md §13.2 steps 3-5).
 */
const MAX_DETAIL_RATIO_FOR_PROBABLE_UPSCALE = 1.15;

const LAPLACIAN_KERNEL = [0, 1, 0, 1, -4, 1, 0, 1, 0];

/**
 * A Laplacian-variance-style high-frequency-energy score: resizes to
 * exactly `width`x`height` (so two images can be compared at the same
 * resolution regardless of their native size), applies a Laplacian
 * (edge-detecting) convolution, and returns the standard deviation of the
 * result. Higher means more genuine high-frequency detail; a smooth or
 * over-smoothed (e.g. naively upscaled) image scores lower.
 */
export async function computeDetailScore(
  path: string,
  width: number,
  height: number,
): Promise<number> {
  const stats = await sharp(path)
    .greyscale()
    .resize(width, height, { fit: "fill" })
    .convolve({ width: 3, height: 3, kernel: LAPLACIAN_KERNEL })
    .stats();
  return stats.channels[0]?.stdev ?? 0;
}

export interface UpscaleDetectionResult {
  probableUpscale: boolean;
  downscaledSimilarity: number;
  /** largerDetail / naivelyUpscaledSmallerDetail, both measured at the larger image's (capped) resolution. */
  detailRatio: number;
  largerDetailScore: number;
}

/**
 * Probable-upscale detection (PLAN.md §13). `larger` must have more
 * pixels than `smaller` and already be confirmed visually related (e.g.
 * classified "resize") — this detector only answers "does the larger one
 * show genuine extra detail," not "are these related at all."
 *
 * Never returns a hard "upscaled" verdict — only ever `probableUpscale`,
 * per §13.2's explicit requirement, since detail-based evidence here is
 * suggestive, not conclusive.
 */
export async function detectProbableUpscale(
  larger: { realPath: string; width: number; height: number },
  smaller: { realPath: string; width: number; height: number },
): Promise<UpscaleDetectionResult> {
  const analysisWidth = Math.min(larger.width, MAX_ANALYSIS_DIMENSION);
  const analysisHeight = Math.min(larger.height, MAX_ANALYSIS_DIMENSION);

  const [downscaledSimilarity, largerDetailScore, smallerUpscaledDetailScore] = await Promise.all([
    compareAtScale(larger.realPath, smaller.realPath, Math.min(smaller.width, smaller.height, 256)),
    computeDetailScore(larger.realPath, analysisWidth, analysisHeight),
    // "Upscale using a known high-quality method": sharp's default resize
    // kernel (Lanczos3) is exactly that; resizing smaller *up* to the
    // larger's analysis dimensions and measuring detail there is step 3-4
    // of §13.2.
    computeDetailScore(smaller.realPath, analysisWidth, analysisHeight),
  ]);

  const detailRatio =
    smallerUpscaledDetailScore > 0
      ? largerDetailScore / smallerUpscaledDetailScore
      : largerDetailScore > 0
        ? Number.POSITIVE_INFINITY
        : 1;

  const probableUpscale =
    downscaledSimilarity >= MIN_DOWNSCALED_SIMILARITY &&
    detailRatio < MAX_DETAIL_RATIO_FOR_PROBABLE_UPSCALE;

  return { probableUpscale, downscaledSimilarity, detailRatio, largerDetailScore };
}
