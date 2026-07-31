import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

export interface ConfirmationFixtureTree {
  root: string;
  inputDir: string;
  cleanup: () => Promise<void>;
}

/**
 * A smooth gradient concentrates almost all of its SSIM-relevant structure
 * into a couple of large-scale features, and turned out to be a bad choice
 * for hash-based tests (see build-perceptual-fixture-tree.ts) — this reuses
 * the same multi-frequency synthetic texture so it behaves like a real
 * photograph for both hashing and SSIM purposes.
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
 * Fixture tree for M5 (confirmation and relationship classification):
 * a source photo plus a resize, a format conversion, a same-dimensions
 * recompression, a 180-degree rotation, and an unrelated image — covering
 * PLAN.md §34's M5 acceptance criteria ("resize, conversion, recompression,
 * and rotation fixtures classified correctly; uncertain pairs are
 * labelled rather than forced").
 */
export async function buildConfirmationFixtureTree(): Promise<ConfirmationFixtureTree> {
  const root = await mkdtemp(join(tmpdir(), "image-origin-confirmation-test-"));
  const inputDir = join(root, "input");
  await mkdir(inputDir, { recursive: true });

  const originalPath = join(inputDir, "original.jpg");
  await sharp(texturedBuffer(320), { raw: { width: 320, height: 320, channels: 3 } })
    .jpeg({ quality: 95 })
    .toFile(originalPath);

  await sharp(originalPath)
    .resize(140, 140)
    .jpeg({ quality: 88 })
    .toFile(join(inputDir, "resized.jpg"));

  await sharp(originalPath).webp({ quality: 90 }).toFile(join(inputDir, "converted.webp"));

  await sharp(originalPath).jpeg({ quality: 40 }).toFile(join(inputDir, "recompressed.jpg"));

  await sharp(originalPath).rotate(180).jpeg({ quality: 95 }).toFile(join(inputDir, "rotated.jpg"));

  await sharp(checkerboardBuffer(320, 20), { raw: { width: 320, height: 320, channels: 3 } })
    .jpeg({ quality: 95 })
    .toFile(join(inputDir, "unrelated.jpg"));

  return {
    root,
    inputDir,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
