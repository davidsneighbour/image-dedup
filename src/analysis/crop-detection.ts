import sharp from "sharp";
import { compareAtScale } from "../matching/similarity.js";

/** Analysis grid size — reuses the same "downscale to a small fixed grid" idea as pHash. */
const GRID_SIZE = 32;
/** Only search crop boxes retaining 50%-97% of the source; above that it's just a resize/recompression (handled elsewhere), below that a match is unreliable at this grid resolution. */
const MIN_RETAIN_FRACTION = 0.5;
const MAX_RETAIN_FRACTION = 0.97;
const SEARCH_STEP = 2;
/** PLAN.md §12.1: "require a high match confidence." Conservative on purpose. */
const MIN_CONFIDENCE = 0.85;
/**
 * The coarse 32x32 grid search is a "look-elsewhere" problem: with
 * hundreds of candidate boxes tried per pair, a moderate-entropy but
 * otherwise unrelated image can occasionally correlate well with *some*
 * subregion purely by chance, especially when both images share a
 * similar smooth low-frequency structure (the coarse grid averages away
 * exactly the fine detail that would tell them apart). A second,
 * independent check on the *actual* pixel region — real SSIM, not a
 * nearest-neighbour-resampled correlation — catches those false
 * positives, the same "cheap candidate filter, then expensive precise
 * confirmation" pattern M4→M5 already uses.
 */
const SSIM_VERIFICATION_THRESHOLD = 0.75;
const SSIM_VERIFICATION_SCALE = 128;

export interface CropBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CropDetectionResult {
  largerImageId: string;
  croppedImageId: string;
  retainedArea: number;
  cropBox: CropBox;
  confidence: number;
}

async function decodeGreyscaleGrid(path: string): Promise<Float64Array> {
  const { data } = await sharp(path)
    .greyscale()
    .resize(GRID_SIZE, GRID_SIZE, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return Float64Array.from(data);
}

/** Nearest-neighbour resample of a `box` region of `grid` (GRID_SIZE x GRID_SIZE) into a new GRID_SIZE x GRID_SIZE grid. */
function resampleRegion(
  grid: Float64Array,
  box: { left: number; top: number; width: number; height: number },
): Float64Array {
  const out = new Float64Array(GRID_SIZE * GRID_SIZE);
  for (let ty = 0; ty < GRID_SIZE; ty++) {
    const sy = Math.min(GRID_SIZE - 1, box.top + Math.floor((ty / GRID_SIZE) * box.height));
    for (let tx = 0; tx < GRID_SIZE; tx++) {
      const sx = Math.min(GRID_SIZE - 1, box.left + Math.floor((tx / GRID_SIZE) * box.width));
      out[ty * GRID_SIZE + tx] = grid[sy * GRID_SIZE + sx] ?? 0;
    }
  }
  return out;
}

function pearsonCorrelation(a: Float64Array, b: Float64Array): number {
  const n = a.length;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i] ?? 0;
    sumB += b[i] ?? 0;
  }
  const meanA = sumA / n;
  const meanB = sumB / n;

  let numerator = 0;
  let denominatorA = 0;
  let denominatorB = 0;
  for (let i = 0; i < n; i++) {
    const da = (a[i] ?? 0) - meanA;
    const db = (b[i] ?? 0) - meanB;
    numerator += da * db;
    denominatorA += da * da;
    denominatorB += db * db;
  }

  const denominator = Math.sqrt(denominatorA * denominatorB);
  return denominator === 0 ? 0 : numerator / denominator;
}

interface BoxSearchResult {
  box: CropBox;
  score: number;
}

function evaluateBox(fullGrid: Float64Array, cropGrid: Float64Array, box: CropBox): number {
  return pearsonCorrelation(resampleRegion(fullGrid, box), cropGrid);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Sliding-window correlation search (PLAN.md §12.1), coarse-to-fine:
 * first tries axis-aligned crop boxes of `fullGrid` at every
 * `SEARCH_STEP`-aligned position and width (height derived from
 * `cropAspectRatio`, since a crop is assumed not to be independently
 * distorted beyond scaling), then refines around the coarse best at
 * step 1. The refinement pass matters more than it sounds: on a 32x32
 * grid, a step-2 search only ever visits even-valued widths/positions, so
 * a true best box that happens to need an odd width is simply never
 * evaluated — close, reachable boxes can score well under the true
 * optimum purely from quantization, occasionally enough to fall under
 * `MIN_CONFIDENCE` for a crop that should clearly have been found. This
 * only ever runs on a small, already-narrowed candidate pool, never
 * broadly, so the extra refinement cost is cheap in context.
 */
function searchBestCropBox(
  fullGrid: Float64Array,
  cropGrid: Float64Array,
  cropAspectRatio: number,
): BoxSearchResult | undefined {
  let best: BoxSearchResult | undefined;

  const minWidth = Math.round(GRID_SIZE * MIN_RETAIN_FRACTION);
  const maxWidth = Math.round(GRID_SIZE * MAX_RETAIN_FRACTION);

  for (let width = minWidth; width <= maxWidth; width += SEARCH_STEP) {
    const height = Math.min(GRID_SIZE, Math.max(1, Math.round(width / cropAspectRatio)));
    for (let top = 0; top <= GRID_SIZE - height; top += SEARCH_STEP) {
      for (let left = 0; left <= GRID_SIZE - width; left += SEARCH_STEP) {
        const box = { left, top, width, height };
        const score = evaluateBox(fullGrid, cropGrid, box);
        if (!best || score > best.score) {
          best = { box, score };
        }
      }
    }
  }

  if (!best) {
    return best;
  }

  for (let dWidth = -SEARCH_STEP; dWidth <= SEARCH_STEP; dWidth++) {
    const width = clamp(best.box.width + dWidth, minWidth, maxWidth);
    const height = Math.min(GRID_SIZE, Math.max(1, Math.round(width / cropAspectRatio)));
    for (let dTop = -SEARCH_STEP; dTop <= SEARCH_STEP; dTop++) {
      const top = clamp(best.box.top + dTop, 0, GRID_SIZE - height);
      for (let dLeft = -SEARCH_STEP; dLeft <= SEARCH_STEP; dLeft++) {
        const left = clamp(best.box.left + dLeft, 0, GRID_SIZE - width);
        const box = { left, top, width, height };
        const score = evaluateBox(fullGrid, cropGrid, box);
        if (score > best.score) {
          best = { box, score };
        }
      }
    }
  }

  return best;
}

interface PixelBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

function clampPixelBox(box: PixelBox, fullWidth: number, fullHeight: number): PixelBox {
  const left = Math.max(0, Math.min(fullWidth - 1, Math.round(box.left)));
  const top = Math.max(0, Math.min(fullHeight - 1, Math.round(box.top)));
  const width = Math.max(1, Math.min(fullWidth - left, Math.round(box.width)));
  const height = Math.max(1, Math.min(fullHeight - top, Math.round(box.height)));
  return { left, top, width, height };
}

async function ssimForPixelBox(
  fullPath: string,
  fullWidth: number,
  fullHeight: number,
  box: PixelBox,
  cropPath: string,
): Promise<number> {
  const clamped = clampPixelBox(box, fullWidth, fullHeight);
  const extractedBuffer = await sharp(fullPath).extract(clamped).toBuffer();
  return compareAtScale(extractedBuffer, cropPath, SSIM_VERIFICATION_SCALE);
}

/** Offsets tried during pixel-space refinement, in units of one grid cell. */
const REFINEMENT_OFFSETS_IN_CELLS = [-1, -0.5, 0, 0.5, 1];

/**
 * The coarse grid search operates on a GRID_SIZE x GRID_SIZE grid — for a
 * typical source image that's a cell every several pixels, and a box
 * that's off by even one cell can misalign fine detail enough to tank
 * real SSIM even though it correlated well on the coarse grid (that's
 * exactly the false-positive/false-negative risk the SSIM check exists to
 * catch). This does a small local search in *real pixel space* around the
 * grid-search's box, using real SSIM as the objective directly, and
 * returns both the best score found and the (now more precise) pixel box
 * that achieved it.
 */
async function refineAndVerifyCropWithSsim(
  fullPath: string,
  fullWidth: number,
  fullHeight: number,
  gridBox: CropBox,
  cropPath: string,
): Promise<{ score: number; pixelBox: PixelBox }> {
  const cellWidth = fullWidth / GRID_SIZE;
  const cellHeight = fullHeight / GRID_SIZE;
  const baseBox: PixelBox = {
    left: Math.round(gridBox.left * fullWidth),
    top: Math.round(gridBox.top * fullHeight),
    width: Math.round(gridBox.width * fullWidth),
    height: Math.round(gridBox.height * fullHeight),
  };

  let best = { score: -1, pixelBox: baseBox };
  for (const dxCells of REFINEMENT_OFFSETS_IN_CELLS) {
    for (const dyCells of REFINEMENT_OFFSETS_IN_CELLS) {
      const trialBox: PixelBox = {
        left: baseBox.left + dxCells * cellWidth,
        top: baseBox.top + dyCells * cellHeight,
        width: baseBox.width,
        height: baseBox.height,
      };
      const score = await ssimForPixelBox(fullPath, fullWidth, fullHeight, trialBox, cropPath);
      if (score > best.score) {
        best = { score, pixelBox: clampPixelBox(trialBox, fullWidth, fullHeight) };
      }
    }
  }

  return best;
}

/**
 * Conservative crop detector (PLAN.md §12). Tries both directions (each
 * image as the possible "full" image containing the other as a
 * subregion) since which one is the crop isn't known in advance, and
 * keeps whichever direction scores higher — but only among directions
 * where the "full" candidate actually has at least as many pixels as the
 * "crop" candidate. Without that constraint, two images that are merely
 * very similar after downscaling (e.g. a plain resize whose SSIM
 * confirmation happened to fail) can spuriously score better in the
 * *backwards* direction — the smaller file "containing" the larger one as
 * a 94%-retained crop of itself, which is nonsensical (a crop cannot have
 * more native pixels than the frame it was cropped from). Caught via
 * manual end-to-end testing, not by the unit tests, which happened to
 * only ever exercise the direction that was already correct.
 *
 * Returns `undefined` unless a candidate box clears `MIN_CONFIDENCE` —
 * silence, not a low-confidence guess, is the correct result for "these
 * aren't a crop of each other."
 */
export async function detectCrop(
  a: { id: string; realPath: string; width: number; height: number },
  b: { id: string; realPath: string; width: number; height: number },
): Promise<CropDetectionResult | undefined> {
  const [gridA, gridB] = await Promise.all([
    decodeGreyscaleGrid(a.realPath),
    decodeGreyscaleGrid(b.realPath),
  ]);

  const pixelsA = a.width * a.height;
  const pixelsB = b.width * b.height;

  const attempts = [
    {
      fullId: a.id,
      fullGrid: gridA,
      fullRealPath: a.realPath,
      fullWidth: a.width,
      fullHeight: a.height,
      fullPixels: pixelsA,
      cropId: b.id,
      cropGrid: gridB,
      cropRealPath: b.realPath,
      cropAspectRatio: b.width / b.height,
      cropPixels: pixelsB,
    },
    {
      fullId: b.id,
      fullGrid: gridB,
      fullRealPath: b.realPath,
      fullWidth: b.width,
      fullHeight: b.height,
      fullPixels: pixelsB,
      cropId: a.id,
      cropGrid: gridA,
      cropRealPath: a.realPath,
      cropAspectRatio: a.width / a.height,
      cropPixels: pixelsA,
    },
  ].filter((attempt) => attempt.fullPixels >= attempt.cropPixels);

  let best: CropDetectionResult | undefined;
  for (const attempt of attempts) {
    const result = searchBestCropBox(attempt.fullGrid, attempt.cropGrid, attempt.cropAspectRatio);
    if (!result || result.score < MIN_CONFIDENCE) {
      continue;
    }

    const gridBox: CropBox = {
      left: result.box.left / GRID_SIZE,
      top: result.box.top / GRID_SIZE,
      width: result.box.width / GRID_SIZE,
      height: result.box.height / GRID_SIZE,
    };

    const refined = await refineAndVerifyCropWithSsim(
      attempt.fullRealPath,
      attempt.fullWidth,
      attempt.fullHeight,
      gridBox,
      attempt.cropRealPath,
    );
    if (refined.score < SSIM_VERIFICATION_THRESHOLD) {
      continue;
    }

    const cropBox: CropBox = {
      left: refined.pixelBox.left / attempt.fullWidth,
      top: refined.pixelBox.top / attempt.fullHeight,
      width: refined.pixelBox.width / attempt.fullWidth,
      height: refined.pixelBox.height / attempt.fullHeight,
    };
    const retainedArea =
      (refined.pixelBox.width * refined.pixelBox.height) / (attempt.fullWidth * attempt.fullHeight);
    const candidate: CropDetectionResult = {
      largerImageId: attempt.fullId,
      croppedImageId: attempt.cropId,
      retainedArea,
      cropBox,
      // Conservative on purpose: the weaker of the two independent
      // signals (coarse correlation, refined real-pixel SSIM) sets confidence.
      confidence: Math.max(0, Math.min(1, Math.min(result.score, refined.score))),
    };
    if (!best || candidate.confidence > best.confidence) {
      best = candidate;
    }
  }

  return best;
}
