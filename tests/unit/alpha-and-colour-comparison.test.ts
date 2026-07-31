import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compareAlpha } from "../../src/analysis/alpha-comparison.js";
import { meanColourDelta } from "../../src/analysis/colour-comparison.js";

describe("compareAlpha", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "image-origin-alpha-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reports no meaningful alpha for records that don't claim to have alpha", async () => {
    const path = join(dir, "opaque.jpg");
    await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .jpeg()
      .toFile(path);

    const result = await compareAlpha(path, false, path, false);
    expect(result).toEqual({
      aHasMeaningfulAlpha: false,
      bHasMeaningfulAlpha: false,
      mismatch: false,
    });
  });

  it("detects meaningful (varying) alpha and flags a mismatch against an opaque image", async () => {
    const transparentPath = join(dir, "transparent.png");
    const opaquePath = join(dir, "opaque.png");
    await sharp({
      create: { width: 16, height: 16, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: 8,
              height: 8,
              channels: 4,
              background: { r: 255, g: 0, b: 0, alpha: 1 },
            },
          })
            .png()
            .toBuffer(),
          left: 4,
          top: 4,
        },
      ])
      .png()
      .toFile(transparentPath);
    await sharp({
      create: { width: 16, height: 16, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
    })
      .png()
      .toFile(opaquePath);

    const result = await compareAlpha(transparentPath, true, opaquePath, true);
    expect(result.aHasMeaningfulAlpha).toBe(true);
    expect(result.bHasMeaningfulAlpha).toBe(false);
    expect(result.mismatch).toBe(true);
  });
});

describe("meanColourDelta", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "image-origin-colour-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("is near 0 for identical images", async () => {
    const path = join(dir, "a.jpg");
    await sharp({
      create: { width: 16, height: 16, channels: 3, background: { r: 100, g: 120, b: 140 } },
    })
      .jpeg()
      .toFile(path);

    expect(await meanColourDelta(path, path)).toBeLessThan(2);
  });

  it("is large for images with very different mean colour", async () => {
    const redPath = join(dir, "red.jpg");
    const bluePath = join(dir, "blue.jpg");
    await sharp({
      create: { width: 16, height: 16, channels: 3, background: { r: 240, g: 10, b: 10 } },
    })
      .jpeg()
      .toFile(redPath);
    await sharp({
      create: { width: 16, height: 16, channels: 3, background: { r: 10, g: 10, b: 240 } },
    })
      .jpeg()
      .toFile(bluePath);

    expect(await meanColourDelta(redPath, bluePath)).toBeGreaterThan(50);
  });
});
