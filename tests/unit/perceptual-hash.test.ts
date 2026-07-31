import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  computeDifferenceHash,
  computePerceptualHash,
  hammingDistanceHex,
} from "../../src/matching/perceptual-hash.js";

/**
 * A smooth linear gradient concentrates almost all of its DCT energy into a
 * handful of coefficients, leaving the rest near-zero and therefore
 * unstable (any tiny resize/recompression noise flips them across the
 * median). Real photographs don't have this problem — they have texture at
 * many frequencies. This synthetic pattern sums several sine/cosine
 * components at different frequencies so it behaves like a real image for
 * hashing purposes, instead of like a pathological edge case.
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
      const value = isLight ? 240 : 15;
      const idx = (y * size + x) * channels;
      buffer[idx] = value;
      buffer[idx + 1] = value;
      buffer[idx + 2] = value;
    }
  }
  return buffer;
}

describe("hammingDistanceHex", () => {
  it("is 0 for identical hashes", () => {
    expect(hammingDistanceHex("abcdef0123456789", "abcdef0123456789")).toBe(0);
  });

  it("counts differing bits across the whole hash", () => {
    // 0x0 vs 0xf differ in all 4 bits; the rest match.
    expect(hammingDistanceHex("0000000000000000", "f000000000000000")).toBe(4);
  });

  it("throws on mismatched hash lengths", () => {
    expect(() => hammingDistanceHex("ab", "abcd")).toThrow();
  });
});

describe("perceptual hashing", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "image-origin-phash-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("produces a 16-character hex string for both hash types", async () => {
    const path = join(dir, "gradient.jpg");
    await sharp(texturedBuffer(64), { raw: { width: 64, height: 64, channels: 3 } })
      .jpeg()
      .toFile(path);

    const dHash = await computeDifferenceHash(path);
    const pHash = await computePerceptualHash(path);

    expect(dHash).toMatch(/^[0-9a-f]{16}$/);
    expect(pHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic for the same file", async () => {
    const path = join(dir, "gradient.jpg");
    await sharp(texturedBuffer(64), { raw: { width: 64, height: 64, channels: 3 } })
      .jpeg()
      .toFile(path);

    expect(await computeDifferenceHash(path)).toBe(await computeDifferenceHash(path));
    expect(await computePerceptualHash(path)).toBe(await computePerceptualHash(path));
  });

  it("stays close (small Hamming distance) for a resized copy of the same image", async () => {
    const originalPath = join(dir, "original.jpg");
    const resizedPath = join(dir, "resized.jpg");
    await sharp(texturedBuffer(256), { raw: { width: 256, height: 256, channels: 3 } })
      .jpeg({ quality: 95 })
      .toFile(originalPath);
    await sharp(originalPath).resize(96, 96).jpeg({ quality: 90 }).toFile(resizedPath);

    const [dA, dB] = await Promise.all([
      computeDifferenceHash(originalPath),
      computeDifferenceHash(resizedPath),
    ]);
    const [pA, pB] = await Promise.all([
      computePerceptualHash(originalPath),
      computePerceptualHash(resizedPath),
    ]);

    expect(hammingDistanceHex(dA, dB)).toBeLessThanOrEqual(10);
    expect(hammingDistanceHex(pA, pB)).toBeLessThanOrEqual(10);
  });

  it("stays close for a format conversion of the same image", async () => {
    const jpegPath = join(dir, "original.jpg");
    const webpPath = join(dir, "converted.webp");
    await sharp(texturedBuffer(128), { raw: { width: 128, height: 128, channels: 3 } })
      .jpeg({ quality: 95 })
      .toFile(jpegPath);
    await sharp(jpegPath).webp({ quality: 90 }).toFile(webpPath);

    const [dA, dB] = await Promise.all([
      computeDifferenceHash(jpegPath),
      computeDifferenceHash(webpPath),
    ]);
    const [pA, pB] = await Promise.all([
      computePerceptualHash(jpegPath),
      computePerceptualHash(webpPath),
    ]);

    expect(hammingDistanceHex(dA, dB)).toBeLessThanOrEqual(10);
    expect(hammingDistanceHex(pA, pB)).toBeLessThanOrEqual(10);
  });

  it("differs substantially between visually unrelated images", async () => {
    const gradientPath = join(dir, "gradient.jpg");
    const checkerboardPath = join(dir, "checkerboard.jpg");
    await sharp(texturedBuffer(128), { raw: { width: 128, height: 128, channels: 3 } })
      .jpeg({ quality: 95 })
      .toFile(gradientPath);
    await sharp(checkerboardBuffer(128, 16), { raw: { width: 128, height: 128, channels: 3 } })
      .jpeg({ quality: 95 })
      .toFile(checkerboardPath);

    const [dA, dB] = await Promise.all([
      computeDifferenceHash(gradientPath),
      computeDifferenceHash(checkerboardPath),
    ]);
    const [pA, pB] = await Promise.all([
      computePerceptualHash(gradientPath),
      computePerceptualHash(checkerboardPath),
    ]);

    expect(hammingDistanceHex(dA, dB)).toBeGreaterThan(10);
    expect(hammingDistanceHex(pA, pB)).toBeGreaterThan(10);
  });
});
