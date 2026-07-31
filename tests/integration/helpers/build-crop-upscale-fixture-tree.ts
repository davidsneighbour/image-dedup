import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

export interface CropUpscaleFixtureTree {
  root: string;
  inputDir: string;
  cleanup: () => Promise<void>;
}

/**
 * Smooth multi-frequency texture (no per-pixel noise) — see
 * perceptual-hash.test.ts for why a plain gradient doesn't work here, and
 * upscale-detection.test.ts for why *this* function doesn't work for
 * upscale testing. Used for the crop pair specifically: crop detection's
 * coarse-to-precise box search only needs pixel-level accuracy to within
 * a handful of pixels, which is fine for real photographs (which have
 * actual spatial correlation) but not for pure per-pixel noise (zero
 * correlation length — any misalignment at all decorrelates it
 * completely). Real crops of real photos behave like this function, not
 * like `detailedTexturedBuffer`.
 */
function texturedBuffer(size: number): Buffer {
  const channels = 3;
  const buffer = Buffer.alloc(size * size * channels);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = x / size;
      const fy = y / size;
      const value =
        128 +
        60 * Math.sin(fx * 6 * Math.PI) +
        40 * Math.cos(fy * 9 * Math.PI) +
        30 * Math.sin((fx + fy) * 13 * Math.PI) +
        20 * Math.sin(fx * fy * 25 * Math.PI);
      const clamped = Math.max(0, Math.min(255, Math.round(value)));
      const idx = (y * size + x) * channels;
      buffer[idx] = clamped;
      buffer[idx + 1] = clamped;
      buffer[idx + 2] = clamped;
    }
  }
  return buffer;
}

function pseudoRandom(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * See tests/unit/upscale-detection.test.ts for why per-pixel noise (not a
 * smooth function of normalized position) is required to make upscale
 * detection testable. `seed` keeps otherwise-unrelated renders from
 * accidentally sharing structure — without it, every call produced the
 * exact same noise pattern (`pseudoRandom` only depends on x/y), which
 * made genuinely unrelated images spuriously resemble each other.
 */
function detailedTexturedBuffer(size: number, seed: number): Buffer {
  const channels = 3;
  const buffer = Buffer.alloc(size * size * channels);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = x / size;
      const fy = y / size;
      const base =
        128 + 40 * Math.sin(fx * 6 * Math.PI + seed) + 20 * Math.cos(fy * 9 * Math.PI + seed);
      const noise = (pseudoRandom(x, y, seed) - 0.5) * 100;
      const clamped = Math.max(0, Math.min(255, Math.round(base + noise)));
      const idx = (y * size + x) * channels;
      buffer[idx] = clamped;
      buffer[idx + 1] = clamped;
      buffer[idx + 2] = clamped;
    }
  }
  return buffer;
}

/**
 * Fixture tree for M6 (crop and upscale detection):
 * - `original.png` / `crop.png`: a genuine crop relationship.
 * - `genuine-small.png` / `genuine-large.png`: a legitimate higher-resolution source (must NOT be flagged as a probable upscale).
 * - `fake-small.png` / `fake-upscaled.png`: a naive upscale with no genuine extra detail (must be flagged).
 *
 * The three pairs use different seeds/generators specifically so they
 * don't spuriously resemble each other — see the doc comments on
 * `texturedBuffer`/`detailedTexturedBuffer` above for why that matters.
 */
export async function buildCropUpscaleFixtureTree(): Promise<CropUpscaleFixtureTree> {
  const root = await mkdtemp(join(tmpdir(), "image-origin-crop-upscale-test-"));
  const inputDir = join(root, "input");
  await mkdir(inputDir, { recursive: true });

  const originalPath = join(inputDir, "original.png");
  await sharp(texturedBuffer(400), { raw: { width: 400, height: 400, channels: 3 } })
    .png()
    .toFile(originalPath);
  await sharp(originalPath)
    .extract({ left: 40, top: 40, width: 320, height: 320 })
    .png()
    .toFile(join(inputDir, "crop.png"));

  const genuineSmallPath = join(inputDir, "genuine-small.png");
  const genuineLargePath = join(inputDir, "genuine-large.png");
  await sharp(detailedTexturedBuffer(500, 1), { raw: { width: 500, height: 500, channels: 3 } })
    .png()
    .toFile(genuineLargePath);
  await sharp(genuineLargePath).resize(120, 120).png().toFile(genuineSmallPath);

  const fakeSmallPath = join(inputDir, "fake-small.png");
  const fakeUpscaledPath = join(inputDir, "fake-upscaled.png");
  await sharp(detailedTexturedBuffer(120, 2), { raw: { width: 120, height: 120, channels: 3 } })
    .png()
    .toFile(fakeSmallPath);
  await sharp(fakeSmallPath).resize(500, 500).png().toFile(fakeUpscaledPath);

  return {
    root,
    inputDir,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
