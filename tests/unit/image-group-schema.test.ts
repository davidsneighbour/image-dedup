import { describe, expect, it } from "vitest";
import { imageGroupSchema } from "../../src/domain/image-group.js";
import type { ImageRecord } from "../../src/domain/image-record.js";
import { computeExactDuplicateGroups } from "../../src/matching/exact-duplicates.js";

function makeRecord(id: string, relativePath: string, sha256: string): ImageRecord {
  return {
    id,
    path: relativePath,
    realPath: `/input/${relativePath}`,
    relativePath,
    file: {
      sizeBytes: 1000,
      modifiedAt: "2026-01-01T00:00:00.000Z",
      sha256,
      inode: Math.floor(Math.random() * 1_000_000),
      device: 1,
    },
    image: { format: "jpeg", width: 100, height: 100, aspectRatio: 1, pages: 1, hasAlpha: false },
    metadata: { exifPresent: false, iptcPresent: false, xmpPresent: false, iccPresent: false },
    hashes: { sha256 },
    quality: {},
    warnings: [],
  };
}

describe("imageGroupSchema", () => {
  it("validates real output from computeExactDuplicateGroups", () => {
    const records = [
      makeRecord("a", "backups/originals/a.jpg", "hash1"),
      makeRecord("b", "public/generated/a.jpg", "hash1"),
    ];
    const { groups } = computeExactDuplicateGroups(records, [
      { pattern: "backups/originals/**", weight: 20 },
    ]);

    for (const group of groups) {
      expect(() => imageGroupSchema.parse(group)).not.toThrow();
    }
  });

  it("rejects a group with fewer than two members", () => {
    const result = imageGroupSchema.safeParse({
      id: "grp_x",
      kind: "exact-duplicate",
      members: ["a"],
      comparisons: [],
      confidence: 1,
      status: "automatic",
      reasons: [],
      warnings: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a recommendedOriginalId that is not one of the members", () => {
    const result = imageGroupSchema.safeParse({
      id: "grp_x",
      kind: "exact-duplicate",
      members: ["a", "b"],
      comparisons: [],
      recommendedOriginalId: "not-a-member",
      confidence: 1,
      status: "automatic",
      reasons: [],
      warnings: [],
    });
    expect(result.success).toBe(false);
  });
});
