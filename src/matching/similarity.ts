import sharp from "sharp";
import * as ssimModule from "ssim.js";
import { type OrientationTransform, applyTransform } from "./orientation-transform.js";

const ssim = ssimModule.ssim;

export type { OrientationTransform };

async function toImageData(
  path: string | Buffer,
  size: number,
  transform: OrientationTransform,
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  // `.rotate()` with no argument auto-orients using EXIF before any
  // further transform is applied, so a rotate180/flip test isn't
  // confused by a source file that's already EXIF-rotated.
  const image = applyTransform(sharp(path).rotate(), transform);
  const { data, info } = await image
    .resize(size, size, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
  };
}

/**
 * SSIM at a single scale (PLAN.md §11.1). Both images are resized to the
 * same `size`x`size` square — a deliberate simplification: candidate pairs
 * reaching this point already passed M4's aspect-ratio tolerance check, so
 * the distortion from forcing a square is applied identically to both
 * images and doesn't bias the comparison.
 */
export async function compareAtScale(
  pathA: string | Buffer,
  pathB: string | Buffer,
  size: number,
  transformB: OrientationTransform = "none",
): Promise<number> {
  const [imageA, imageB] = await Promise.all([
    toImageData(pathA, size, "none"),
    toImageData(pathB, size, transformB),
  ]);
  const { mssim } = ssim(imageA, imageB);
  return mssim;
}

export interface MultiScaleSsimResult {
  score: number;
  scoresByScale: Array<{ scale: number; score: number }>;
}

export interface MultiScaleSsimOptions {
  primaryScale?: number;
  secondaryScale?: number;
  /** Minimum primary-scale score worth refining at a larger scale — avoids the expense on clear non-matches. */
  plausibleMargin?: number;
}

/**
 * Multi-scale SSIM comparison (PLAN.md §11.1): compares at a small scale
 * first, then — only if that result is plausible — refines at a larger
 * scale (capped by the images' actual resolution, never upscaled beyond
 * their native size purely for comparison). The most detailed score
 * computed is the one returned, since finer detail is more authoritative.
 */
export async function compareMultiScale(
  pathA: string,
  pathB: string,
  dimensions: { widthA: number; heightA: number; widthB: number; heightB: number },
  options: MultiScaleSsimOptions = {},
): Promise<MultiScaleSsimResult> {
  const primaryScale = options.primaryScale ?? 256;
  const secondaryScaleCap = options.secondaryScale ?? 1024;
  const plausibleMargin = options.plausibleMargin ?? 0.5;

  const primaryScore = await compareAtScale(pathA, pathB, primaryScale);
  const scoresByScale: MultiScaleSsimResult["scoresByScale"] = [
    { scale: primaryScale, score: primaryScore },
  ];

  const maxUsefulScale = Math.min(
    dimensions.widthA,
    dimensions.heightA,
    dimensions.widthB,
    dimensions.heightB,
    secondaryScaleCap,
  );

  if (maxUsefulScale > primaryScale && primaryScore >= plausibleMargin) {
    const secondaryScore = await compareAtScale(pathA, pathB, maxUsefulScale);
    scoresByScale.push({ scale: maxUsefulScale, score: secondaryScore });
  }

  const finalEntry = scoresByScale.at(-1);
  return { score: finalEntry?.score ?? primaryScore, scoresByScale };
}
