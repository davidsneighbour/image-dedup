import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compareAtScale, compareMultiScale } from "../../src/matching/similarity.js";

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

describe("similarity", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "image-origin-ssim-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("scores an image against itself near 1.0", async () => {
    const path = join(dir, "original.jpg");
    await sharp(texturedBuffer(256), { raw: { width: 256, height: 256, channels: 3 } })
      .jpeg({ quality: 95 })
      .toFile(path);

    const score = await compareAtScale(path, path, 128);
    expect(score).toBeGreaterThan(0.99);
  });

  it("scores a resized copy of the same image highly", async () => {
    const originalPath = join(dir, "original.jpg");
    const resizedPath = join(dir, "resized.jpg");
    await sharp(texturedBuffer(256), { raw: { width: 256, height: 256, channels: 3 } })
      .jpeg({ quality: 95 })
      .toFile(originalPath);
    await sharp(originalPath).resize(96, 96).jpeg({ quality: 88 }).toFile(resizedPath);

    const result = await compareMultiScale(originalPath, resizedPath, {
      widthA: 256,
      heightA: 256,
      widthB: 96,
      heightB: 96,
    });
    expect(result.score).toBeGreaterThan(0.9);
  });

  it("scores visually unrelated images low", async () => {
    const texturedPath = join(dir, "textured.jpg");
    const checkerboardPath = join(dir, "checkerboard.jpg");
    await sharp(texturedBuffer(256), { raw: { width: 256, height: 256, channels: 3 } })
      .jpeg({ quality: 95 })
      .toFile(texturedPath);
    await sharp(checkerboardBuffer(256, 24), { raw: { width: 256, height: 256, channels: 3 } })
      .jpeg({ quality: 95 })
      .toFile(checkerboardPath);

    const score = await compareAtScale(texturedPath, checkerboardPath, 128);
    expect(score).toBeLessThan(0.5);
  });

  it("only refines at a larger scale when the primary-scale result is plausible", async () => {
    const texturedPath = join(dir, "textured.jpg");
    const checkerboardPath = join(dir, "checkerboard.jpg");
    await sharp(texturedBuffer(256), { raw: { width: 256, height: 256, channels: 3 } })
      .jpeg({ quality: 95 })
      .toFile(texturedPath);
    await sharp(checkerboardBuffer(256, 24), { raw: { width: 256, height: 256, channels: 3 } })
      .jpeg({ quality: 95 })
      .toFile(checkerboardPath);

    const result = await compareMultiScale(
      texturedPath,
      checkerboardPath,
      { widthA: 256, heightA: 256, widthB: 256, heightB: 256 },
      { plausibleMargin: 0.5 },
    );
    // Implausible primary score means no second scale is attempted.
    expect(result.scoresByScale).toHaveLength(1);
  });

  it("recovers a high score for a 180-degree-rotated image once the matching transform is applied", async () => {
    const originalPath = join(dir, "original.jpg");
    const rotatedPath = join(dir, "rotated.jpg");
    await sharp(texturedBuffer(256), { raw: { width: 256, height: 256, channels: 3 } })
      .jpeg({ quality: 95 })
      .toFile(originalPath);
    await sharp(originalPath).rotate(180).jpeg({ quality: 95 }).toFile(rotatedPath);

    const withoutTransform = await compareAtScale(originalPath, rotatedPath, 128, "none");
    const withTransform = await compareAtScale(originalPath, rotatedPath, 128, "rotate180");

    expect(withoutTransform).toBeLessThan(0.5);
    expect(withTransform).toBeGreaterThan(0.9);
  });

  it("recovers a high score for a horizontally-mirrored image once the matching transform is applied", async () => {
    const originalPath = join(dir, "original.jpg");
    const mirroredPath = join(dir, "mirrored.jpg");
    await sharp(texturedBuffer(256), { raw: { width: 256, height: 256, channels: 3 } })
      .jpeg({ quality: 95 })
      .toFile(originalPath);
    await sharp(originalPath).flop().jpeg({ quality: 95 }).toFile(mirroredPath);

    const withoutTransform = await compareAtScale(originalPath, mirroredPath, 128, "none");
    const withTransform = await compareAtScale(originalPath, mirroredPath, 128, "flipHorizontal");

    expect(withoutTransform).toBeLessThan(0.5);
    expect(withTransform).toBeGreaterThan(0.9);
  });
});
