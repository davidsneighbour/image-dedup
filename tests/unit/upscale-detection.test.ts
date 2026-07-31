import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectProbableUpscale } from "../../src/analysis/upscale-detection.js";

/** Deterministic pseudo-random value in [0, 1) for integer pixel coordinates. */
function pseudoRandom(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * A smooth low-frequency base plus per-*integer-pixel* noise. The noise
 * term is the key: it's keyed off actual pixel coordinates, not
 * normalized position, so a render at a higher `size` has genuinely more
 * independent high-frequency samples — exactly what a naive upscale of a
 * smaller render can't recreate (resize interpolation smooths across
 * neighbouring pixels, it doesn't invent new independent noise). A plain
 * smooth function of normalized position (as used elsewhere in this test
 * suite for pHash/SSIM) doesn't work here: at any resolution it's fully
 * determined by a few low frequencies, so downscaling then upscaling it
 * loses essentially nothing — useless for telling genuine detail apart
 * from a naive upscale, which is exactly what this detector measures. PNG
 * (lossless) avoids JPEG compression noise confounding the comparison.
 */
function detailedTexturedBuffer(size: number): Buffer {
  const channels = 3;
  const buffer = Buffer.alloc(size * size * channels);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = x / size;
      const fy = y / size;
      const base = 128 + 40 * Math.sin(fx * 6 * Math.PI) + 20 * Math.cos(fy * 9 * Math.PI);
      const noise = (pseudoRandom(x, y) - 0.5) * 100;
      const clamped = Math.max(0, Math.min(255, Math.round(base + noise)));
      const idx = (y * size + x) * channels;
      buffer[idx] = clamped;
      buffer[idx + 1] = clamped;
      buffer[idx + 2] = clamped;
    }
  }
  return buffer;
}

describe("detectProbableUpscale", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "image-origin-upscale-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("flags a naively-upscaled image as a probable upscale against its genuine small source", async () => {
    const smallPath = join(dir, "small.png");
    const fakeUpscaledPath = join(dir, "fake-upscaled.png");

    await sharp(detailedTexturedBuffer(100), { raw: { width: 100, height: 100, channels: 3 } })
      .png()
      .toFile(smallPath);
    // Simulates someone upscaling a small image and re-saving it: no
    // genuine extra detail is added beyond what resize interpolation
    // produces.
    await sharp(smallPath).resize(400, 400).png().toFile(fakeUpscaledPath);

    const result = await detectProbableUpscale(
      { realPath: fakeUpscaledPath, width: 400, height: 400 },
      { realPath: smallPath, width: 100, height: 100 },
    );

    expect(result.probableUpscale).toBe(true);
    expect(result.detailRatio).toBeLessThan(1.15);
  });

  it("does not flag a genuine higher-resolution source against a legitimate smaller derivative", async () => {
    const largePath = join(dir, "large.png");
    const smallPath = join(dir, "small.png");

    // Rendered directly at 400x400 — genuine fine detail at that
    // resolution, not derived from upscaling anything smaller.
    await sharp(detailedTexturedBuffer(400), { raw: { width: 400, height: 400, channels: 3 } })
      .png()
      .toFile(largePath);
    await sharp(largePath).resize(100, 100).png().toFile(smallPath);

    const result = await detectProbableUpscale(
      { realPath: largePath, width: 400, height: 400 },
      { realPath: smallPath, width: 100, height: 100 },
    );

    expect(result.probableUpscale).toBe(false);
    expect(result.detailRatio).toBeGreaterThan(1.15);
  });
});
