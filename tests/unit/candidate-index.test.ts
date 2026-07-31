import { describe, expect, it } from "vitest";
import type { ImageRecord } from "../../src/domain/image-record.js";
import { generateCandidatePairs } from "../../src/matching/candidate-index.js";

const BASE_HASH = "0000000000000000";

/** Flips `bits` low-order bits of the hash's first nibble(s) to control Hamming distance precisely. */
function hashAtDistance(bits: number): string {
  if (bits > 4) {
    throw new Error("test helper only supports distances up to 4 bits");
  }
  const nibble = (0b1111 >> (4 - bits)).toString(16);
  return nibble + BASE_HASH.slice(1);
}

function makeRecord(overrides: {
  id: string;
  sha256: string;
  aspectRatio?: number;
  dHash?: string;
  pHash?: string;
}): ImageRecord {
  return {
    id: overrides.id,
    path: `${overrides.id}.jpg`,
    realPath: `/input/${overrides.id}.jpg`,
    relativePath: `${overrides.id}.jpg`,
    file: {
      sizeBytes: 1000,
      modifiedAt: "2026-01-01T00:00:00.000Z",
      sha256: overrides.sha256,
      inode: 1,
      device: 1,
    },
    image: {
      format: "jpeg",
      width: 100,
      height: Math.round(100 / (overrides.aspectRatio ?? 1)),
      aspectRatio: overrides.aspectRatio ?? 1,
      pages: 1,
      hasAlpha: false,
    },
    metadata: { exifPresent: false, iptcPresent: false, xmpPresent: false, iccPresent: false },
    hashes: {
      sha256: overrides.sha256,
      difference: overrides.dHash ?? BASE_HASH,
      perceptual: overrides.pHash ?? BASE_HASH,
    },
    quality: {},
    warnings: [],
  };
}

const CONFIG = { perceptualDistanceThreshold: 10, aspectRatioTolerance: 0.015 };

describe("generateCandidatePairs", () => {
  it("pairs records whose dHash and pHash are both within the threshold", () => {
    const records = [
      makeRecord({ id: "a", sha256: "hash-a" }),
      makeRecord({ id: "b", sha256: "hash-b", dHash: hashAtDistance(2), pHash: hashAtDistance(2) }),
    ];

    const pairs = generateCandidatePairs(records, CONFIG);

    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ a: "a", b: "b", dHashDistance: 2, pHashDistance: 2 });
  });

  it("does not pair records whose dHash distance exceeds the threshold", () => {
    const records = [
      makeRecord({ id: "a", sha256: "hash-a" }),
      makeRecord({ id: "b", sha256: "hash-b", dHash: "ffffffffffffffff", pHash: BASE_HASH }),
    ];

    expect(generateCandidatePairs(records, CONFIG)).toHaveLength(0);
  });

  it("requires pHash to also be within threshold even when dHash matches", () => {
    const records = [
      makeRecord({ id: "a", sha256: "hash-a" }),
      makeRecord({ id: "b", sha256: "hash-b", dHash: BASE_HASH, pHash: "ffffffffffffffff" }),
    ];

    expect(generateCandidatePairs(records, CONFIG)).toHaveLength(0);
  });

  it("excludes pairs that are already exact duplicates (same SHA-256)", () => {
    const records = [
      makeRecord({ id: "a", sha256: "same-hash" }),
      makeRecord({ id: "b", sha256: "same-hash" }),
    ];

    expect(generateCandidatePairs(records, CONFIG)).toHaveLength(0);
  });

  it("excludes pairs whose aspect ratio differs beyond the configured tolerance", () => {
    const records = [
      makeRecord({ id: "a", sha256: "hash-a", aspectRatio: 1 }),
      makeRecord({
        id: "b",
        sha256: "hash-b",
        aspectRatio: 2,
        dHash: hashAtDistance(1),
        pHash: hashAtDistance(1),
      }),
    ];

    expect(generateCandidatePairs(records, CONFIG)).toHaveLength(0);
  });

  it("still finds candidates whose aspect ratios straddle a bucket boundary", () => {
    // Bucket width is 4x the tolerance (0.015 -> 0.06). 1.02 is exactly on
    // a bucket boundary (17 * 0.06); these two ratios land in adjacent
    // buckets (16 and 17) while their difference (0.002) is well within
    // the configured tolerance (0.015) — only correct if neighbouring
    // buckets are included in the candidate pool.
    const records = [
      makeRecord({ id: "a", sha256: "hash-a", aspectRatio: 1.019 }),
      makeRecord({
        id: "b",
        sha256: "hash-b",
        aspectRatio: 1.021,
        dHash: hashAtDistance(1),
        pHash: hashAtDistance(1),
      }),
    ];

    const pairs = generateCandidatePairs(records, CONFIG);
    expect(pairs).toHaveLength(1);
  });

  it("does not produce duplicate a/b and b/a pairs", () => {
    const records = [
      makeRecord({ id: "a", sha256: "hash-a" }),
      makeRecord({ id: "b", sha256: "hash-b", dHash: hashAtDistance(1), pHash: hashAtDistance(1) }),
      makeRecord({ id: "c", sha256: "hash-c", dHash: hashAtDistance(1), pHash: hashAtDistance(1) }),
    ];

    const pairs = generateCandidatePairs(records, CONFIG);
    const keys = pairs.map((p) => `${p.a}:${p.b}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("does not pair unrelated images with very different hashes", () => {
    const records = [
      makeRecord({
        id: "a",
        sha256: "hash-a",
        dHash: "0000000000000000",
        pHash: "0000000000000000",
      }),
      makeRecord({
        id: "b",
        sha256: "hash-b",
        dHash: "ffffffffffffffff",
        pHash: "ffffffffffffffff",
      }),
      makeRecord({
        id: "c",
        sha256: "hash-c",
        dHash: "5555555555555555",
        pHash: "5555555555555555",
      }),
    ];

    expect(generateCandidatePairs(records, CONFIG)).toHaveLength(0);
  });
});
