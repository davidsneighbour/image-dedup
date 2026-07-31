import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

export interface PerceptualFixtureTree {
  root: string;
  inputDir: string;
  cleanup: () => Promise<void>;
}

/**
 * A smooth gradient concentrates almost all of its DCT energy into a
 * handful of coefficients, leaving the rest near-zero and unstable under
 * any resize/recompression noise. Real photographs don't have this
 * problem — texture at many frequencies keeps the hash's bit decisions
 * stable. This synthetic pattern sums several sine/cosine components so it
 * behaves like a real image for hashing purposes.
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

function checkerboardBuffer(size: number, blockSize: number): Buffer {
  const channels = 3;
  const buffer = Buffer.alloc(size * size * channels);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const isLight = (Math.floor(x / blockSize) + Math.floor(y / blockSize)) % 2 === 0;
      const value = isLight ? 235 : 20;
      const idx = (y * size + x) * channels;
      buffer[idx] = value;
      buffer[idx + 1] = value;
      buffer[idx + 2] = value;
    }
  }
  return buffer;
}

/**
 * Fixture tree for M4 (perceptual matching): a source photo, a resized
 * derivative, a format-converted derivative, and a visually unrelated
 * image — matching PLAN.md §10.4's "resized JPEG versus source JPEG" and
 * "JPEG versus WebP" test cases, plus an unrelated-image negative case.
 */
export async function buildPerceptualFixtureTree(): Promise<PerceptualFixtureTree> {
  const root = await mkdtemp(join(tmpdir(), "image-origin-perceptual-test-"));
  const inputDir = join(root, "input");
  await mkdir(inputDir, { recursive: true });

  const originalPath = join(inputDir, "original.jpg");
  await sharp(texturedBuffer(320), { raw: { width: 320, height: 320, channels: 3 } })
    .jpeg({ quality: 95 })
    .toFile(originalPath);

  await sharp(originalPath)
    .resize(120, 120)
    .jpeg({ quality: 88 })
    .toFile(join(inputDir, "resized.jpg"));

  await sharp(originalPath).webp({ quality: 90 }).toFile(join(inputDir, "converted.webp"));

  await sharp(checkerboardBuffer(320, 20), { raw: { width: 320, height: 320, channels: 3 } })
    .jpeg({ quality: 95 })
    .toFile(join(inputDir, "unrelated.jpg"));

  return {
    root,
    inputDir,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
