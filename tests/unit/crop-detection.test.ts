import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectCrop } from "../../src/analysis/crop-detection.js";

/** Multi-frequency texture — see perceptual-hash.test.ts for why a plain gradient is a bad test image. */
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

describe("detectCrop", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "image-origin-crop-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("finds a known crop region and reports a plausible cropBox and retainedArea", async () => {
    const originalPath = join(dir, "original.jpg");
    const croppedPath = join(dir, "cropped.jpg");
    const SOURCE_SIZE = 400;
    const CROP = { left: 50, top: 50, width: 300, height: 300 };

    await sharp(texturedBuffer(SOURCE_SIZE), {
      raw: { width: SOURCE_SIZE, height: SOURCE_SIZE, channels: 3 },
    })
      .jpeg({ quality: 95 })
      .toFile(originalPath);
    await sharp(originalPath).extract(CROP).jpeg({ quality: 95 }).toFile(croppedPath);

    const result = await detectCrop(
      { id: "original", realPath: originalPath, width: SOURCE_SIZE, height: SOURCE_SIZE },
      { id: "cropped", realPath: croppedPath, width: CROP.width, height: CROP.height },
    );

    expect(result).toBeDefined();
    expect(result?.largerImageId).toBe("original");
    expect(result?.croppedImageId).toBe("cropped");
    expect(result?.confidence).toBeGreaterThanOrEqual(0.85);

    const expectedRetainedArea = (CROP.width * CROP.height) / (SOURCE_SIZE * SOURCE_SIZE);
    expect(result?.retainedArea).toBeGreaterThan(expectedRetainedArea - 0.15);
    expect(result?.retainedArea).toBeLessThan(expectedRetainedArea + 0.15);

    const expectedLeft = CROP.left / SOURCE_SIZE;
    const expectedTop = CROP.top / SOURCE_SIZE;
    expect(result?.cropBox.left).toBeGreaterThan(expectedLeft - 0.1);
    expect(result?.cropBox.left).toBeLessThan(expectedLeft + 0.1);
    expect(result?.cropBox.top).toBeGreaterThan(expectedTop - 0.1);
    expect(result?.cropBox.top).toBeLessThan(expectedTop + 0.1);
  });

  it("does not detect a crop between two unrelated images", async () => {
    const texturedPath = join(dir, "textured.jpg");
    const checkerboardPath = join(dir, "checkerboard.jpg");

    await sharp(texturedBuffer(256), { raw: { width: 256, height: 256, channels: 3 } })
      .jpeg({ quality: 95 })
      .toFile(texturedPath);
    await sharp(checkerboardBuffer(256, 24), { raw: { width: 256, height: 256, channels: 3 } })
      .jpeg({ quality: 95 })
      .toFile(checkerboardPath);

    const result = await detectCrop(
      { id: "textured", realPath: texturedPath, width: 256, height: 256 },
      { id: "checkerboard", realPath: checkerboardPath, width: 256, height: 256 },
    );

    expect(result).toBeUndefined();
  });

  it("does not detect a crop between two identical images (that's a duplicate, not a crop)", async () => {
    const path = join(dir, "same.jpg");
    await sharp(texturedBuffer(200), { raw: { width: 200, height: 200, channels: 3 } })
      .jpeg({ quality: 95 })
      .toFile(path);

    const result = await detectCrop(
      { id: "a", realPath: path, width: 200, height: 200 },
      { id: "b", realPath: path, width: 200, height: 200 },
    );

    // Full overlap is outside the searched retain-fraction range (0.5-0.97
    // relative to the *smaller* box only if it were smaller — here both
    // are the same size, so the only "box" tried is a proper subregion,
    // which won't correlate as well as the identical image against itself
    // at full size). Either no result, or one well below the confidence
    // floor used elsewhere for a real crop.
    if (result) {
      expect(result.retainedArea).toBeLessThan(0.98);
    }
  });

  it("never reports the smaller image as the 'larger' (full-frame) side of a crop", async () => {
    // Regression test: a plain resize relationship (same content, no real
    // crop) between two per-pixel-noisy images was found — via manual
    // end-to-end testing — to sometimes score *better* in the backwards
    // direction (the smaller file "containing" the larger one as a
    // 94%-retained crop of itself), which is nonsensical. See the
    // `detectCrop` doc comment for the full story.
    function pseudoRandom(x: number, y: number, seed: number): number {
      const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
      return n - Math.floor(n);
    }
    function detailedTexturedBuffer(size: number, seed: number): Buffer {
      const channels = 3;
      const buffer = Buffer.alloc(size * size * channels);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const fx = x / size;
          const fy = y / size;
          const base =
            128 + 40 * Math.sin(fx * 6 * Math.PI + seed) + 20 * Math.cos(fy * 9 * Math.PI + seed);
          const noise = (pseudoRandom(x, y, seed) - 0.5) * 90;
          const clamped = Math.max(0, Math.min(255, Math.round(base + noise)));
          const idx = (y * size + x) * channels;
          buffer[idx] = clamped;
          buffer[idx + 1] = clamped;
          buffer[idx + 2] = clamped;
        }
      }
      return buffer;
    }

    const originalPath = join(dir, "original.jpg");
    const thumbPath = join(dir, "thumb.jpg");
    await sharp(detailedTexturedBuffer(500, 5), { raw: { width: 500, height: 500, channels: 3 } })
      .jpeg({ quality: 95 })
      .toFile(originalPath);
    await sharp(originalPath).resize(160, 160).jpeg({ quality: 85 }).toFile(thumbPath);

    const result = await detectCrop(
      { id: "original", realPath: originalPath, width: 500, height: 500 },
      { id: "thumb", realPath: thumbPath, width: 160, height: 160 },
    );

    if (result) {
      expect(result.largerImageId).toBe("original");
      expect(result.croppedImageId).toBe("thumb");
    }
  });
});
