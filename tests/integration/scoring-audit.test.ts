import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveDefaultConfig } from "../../src/config/defaults.js";
import type { ImageGroup } from "../../src/domain/image-group.js";
import { inspectImage } from "../../src/inventory/inspect-image.js";
import { recommendGroupOriginal } from "../../src/scoring/recommend-group-originals.js";
import {
  buildScoringContext,
  gatherMemberSignals,
  scoreCandidate,
} from "../../src/scoring/score-candidate.js";

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

function baseGroup(members: string[]): ImageGroup {
  return {
    id: "grp_test",
    kind: "visual",
    members,
    comparisons: [
      { a: members[0]!, b: members[1]!, relationship: "resize", confidence: 0.98, reasons: [] },
    ],
    confidence: 0.98,
    status: "manual-review",
    reasons: [],
    warnings: [],
  };
}

describe("M7 scoring: genuine source ranks above derivatives", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "image-origin-scoring-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("scores a genuine high-resolution source above a resized derivative", async () => {
    const originalPath = join(dir, "original.png");
    const resizedPath = join(dir, "resized.png");
    await sharp(detailedTexturedBuffer(400, 1), { raw: { width: 400, height: 400, channels: 3 } })
      .png()
      .toFile(originalPath);
    await sharp(originalPath).resize(120, 120).png().toFile(resizedPath);

    const config = resolveDefaultConfig([dir]);
    const originalRecord = await inspectImage({
      realPath: originalPath,
      path: originalPath,
      relativePath: "original.png",
      maxInputPixels: config.limits.maxInputPixels,
    });
    const resizedRecord = await inspectImage({
      realPath: resizedPath,
      path: resizedPath,
      relativePath: "resized.png",
      maxInputPixels: config.limits.maxInputPixels,
    });

    const group = baseGroup([originalRecord.id, resizedRecord.id]);
    const [originalSignals, resizedSignals] = await Promise.all([
      gatherMemberSignals(originalRecord, group, []),
      gatherMemberSignals(resizedRecord, group, []),
    ]);
    const context = buildScoringContext([originalSignals, resizedSignals]);
    const originalScore = scoreCandidate(
      originalSignals,
      context,
      config.scoring.weights,
      config.scoring.penalties,
    );
    const resizedScore = scoreCandidate(
      resizedSignals,
      context,
      config.scoring.weights,
      config.scoring.penalties,
    );

    expect(originalScore.total).toBeGreaterThan(resizedScore.total);
    expect(originalScore.disqualified).toBe(false);
  });

  it("produces a recommendation with reasons when confidence is high, via the full orchestration", async () => {
    const originalPath = join(dir, "original.png");
    const resizedPath = join(dir, "resized.png");
    await sharp(detailedTexturedBuffer(400, 2), { raw: { width: 400, height: 400, channels: 3 } })
      .png()
      .toFile(originalPath);
    await sharp(originalPath).resize(120, 120).png().toFile(resizedPath);

    const config = resolveDefaultConfig([dir]);
    const originalRecord = await inspectImage({
      realPath: originalPath,
      path: originalPath,
      relativePath: "original.png",
      maxInputPixels: config.limits.maxInputPixels,
    });
    const resizedRecord = await inspectImage({
      realPath: resizedPath,
      path: resizedPath,
      relativePath: "resized.png",
      maxInputPixels: config.limits.maxInputPixels,
    });

    const recordsById = new Map([
      [originalRecord.id, originalRecord],
      [resizedRecord.id, resizedRecord],
    ]);
    const group = baseGroup([originalRecord.id, resizedRecord.id]);
    group.confidence = 0.99; // simulate a strongly-confirmed group from M5

    const result = await recommendGroupOriginal(group, recordsById, {
      scoring: config.scoring,
      review: config.review,
      pathPreferences: config.pathPreferences,
    });

    expect(result.reasons.length).toBeGreaterThan(0);
    if (result.status === "automatic") {
      expect(result.recommendedOriginalId).toBe(originalRecord.id);
      expect(result.score).toBeDefined();
    } else {
      // Even without reaching automatic status, the explanation must still be present.
      expect(result.reasons.some((r) => r.includes("possible candidate"))).toBe(true);
    }
  });

  it("never sets status automatic when candidates score too similarly (ambiguous)", async () => {
    const aPath = join(dir, "a.png");
    const bPath = join(dir, "b.png");
    // Two independently-rendered images with the same statistical profile:
    // scores should land close together, and low base confidence keeps
    // the group out of "automatic" regardless.
    await sharp(detailedTexturedBuffer(200, 10), { raw: { width: 200, height: 200, channels: 3 } })
      .png()
      .toFile(aPath);
    await sharp(detailedTexturedBuffer(200, 10), { raw: { width: 200, height: 200, channels: 3 } })
      .png()
      .toFile(bPath);

    const config = resolveDefaultConfig([dir]);
    const recordA = await inspectImage({
      realPath: aPath,
      path: aPath,
      relativePath: "a.png",
      maxInputPixels: config.limits.maxInputPixels,
    });
    const recordB = await inspectImage({
      realPath: bPath,
      path: bPath,
      relativePath: "b.png",
      maxInputPixels: config.limits.maxInputPixels,
    });

    const recordsById = new Map([
      [recordA.id, recordA],
      [recordB.id, recordB],
    ]);
    const group = baseGroup([recordA.id, recordB.id]);
    group.confidence = 0.6; // deliberately low — an ambiguous group

    const result = await recommendGroupOriginal(group, recordsById, {
      scoring: config.scoring,
      review: config.review,
      pathPreferences: config.pathPreferences,
    });

    expect(result.status).not.toBe("automatic");
    expect(result.recommendedOriginalId).toBeUndefined();
  });
});
