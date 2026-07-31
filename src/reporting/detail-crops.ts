import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

/** Displayed at equal dimensions regardless of crop source size (PLAN.md §20.3: "Show all candidate crops at equal displayed dimensions"). */
const DISPLAY_SIZE = 320;
/** Crop region side length, capped so this stays cheap on very large sources. */
const MAX_CROP_SIDE = 512;
/** Candidate positions per axis for the highest-detail grid search. */
const GRID_STEPS = 4;
/** Analysis resolution for scoring each candidate region — only relative ranking matters, not absolute magnitude. */
const SCORE_ANALYSIS_SIZE = 96;

const LAPLACIAN_KERNEL = [0, 1, 0, 1, -4, 1, 0, 1, 0];

interface CropBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DetailCropPaths {
  center: string;
  highestDetail: string;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function cropSide(width: number, height: number): number {
  return Math.max(1, Math.min(width, height, MAX_CROP_SIDE));
}

function centerBox(width: number, height: number, side: number): CropBox {
  return {
    left: Math.floor((width - side) / 2),
    top: Math.floor((height - side) / 2),
    width: side,
    height: side,
  };
}

/**
 * A Laplacian-variance-style high-frequency-energy score for one region —
 * same idea as `computeDetailScore` in `analysis/upscale-detection.ts`,
 * but kept independent here: that one scores a whole image at matched
 * resolution for upscale detection, this one ranks candidate *regions*
 * within a single image for crop selection, a different comparison.
 */
async function regionDetailScore(realPath: string, box: CropBox): Promise<number> {
  const stats = await sharp(realPath)
    .extract(box)
    .resize(SCORE_ANALYSIS_SIZE, SCORE_ANALYSIS_SIZE, { fit: "fill" })
    .greyscale()
    .convolve({ width: 3, height: 3, kernel: LAPLACIAN_KERNEL })
    .stats();
  return stats.channels[0]?.stdev ?? 0;
}

/**
 * Coarse-to-fine would be overkill here (unlike crop-detection.ts's
 * whole-image search): this only needs *a* representative high-detail
 * region, not a precise match, so a flat grid search is sufficient.
 */
async function findHighestDetailBox(realPath: string, width: number, height: number, side: number) {
  const maxLeft = width - side;
  const maxTop = height - side;
  const stepsX = maxLeft > 0 ? GRID_STEPS : 1;
  const stepsY = maxTop > 0 ? GRID_STEPS : 1;

  const candidates: CropBox[] = [];
  for (let iy = 0; iy < stepsY; iy++) {
    for (let ix = 0; ix < stepsX; ix++) {
      const left = stepsX > 1 ? Math.round((maxLeft * ix) / (stepsX - 1)) : 0;
      const top = stepsY > 1 ? Math.round((maxTop * iy) / (stepsY - 1)) : 0;
      candidates.push({ left, top, width: side, height: side });
    }
  }

  const scored = await Promise.all(
    candidates.map(async (box) => ({ box, score: await regionDetailScore(realPath, box) })),
  );
  scored.sort((a, b) => b.score - a.score);
  return scored[0]!.box;
}

async function extractAndSave(realPath: string, box: CropBox, outputPath: string): Promise<void> {
  await sharp(realPath)
    .extract(box)
    .resize(DISPLAY_SIZE, DISPLAY_SIZE, { fit: "fill" })
    .webp({ quality: 88 })
    .toFile(outputPath);
}

/**
 * Generates (or reuses) two comparable crop regions for one image: the
 * geometric centre, and the region with the most genuine high-frequency
 * detail (PLAN.md §20.3). Deliberately does not auto-orient via EXIF
 * (unlike `thumbnails.ts`) — box coordinates are computed and applied
 * against the same (raw, stored) pixel grid as `record.image.width`/
 * `height` elsewhere in this codebase, so there's no risk of an
 * orientation-swapped box being extracted from a differently-oriented
 * decode.
 */
export async function ensureDetailCrops(
  record: { realPath: string; file: { sha256: string }; image: { width: number; height: number } },
  cacheDir: string,
): Promise<DetailCropPaths> {
  await mkdir(cacheDir, { recursive: true });
  const centerPath = join(cacheDir, `${record.file.sha256}-center.webp`);
  const detailPath = join(cacheDir, `${record.file.sha256}-detail.webp`);

  const [centerExists, detailExists] = await Promise.all([
    fileExists(centerPath),
    fileExists(detailPath),
  ]);
  if (centerExists && detailExists) {
    return { center: centerPath, highestDetail: detailPath };
  }

  const { width, height } = record.image;
  const side = cropSide(width, height);

  const [center, highestDetail] = await Promise.all([
    Promise.resolve(centerBox(width, height, side)),
    findHighestDetailBox(record.realPath, width, height, side),
  ]);

  await Promise.all([
    extractAndSave(record.realPath, center, centerPath),
    extractAndSave(record.realPath, highestDetail, detailPath),
  ]);

  return { center: centerPath, highestDetail: detailPath };
}
