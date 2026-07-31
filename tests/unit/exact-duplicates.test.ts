import { describe, expect, it } from "vitest";
import type { ImageRecord } from "../../src/domain/image-record.js";
import { computeExactDuplicateGroups } from "../../src/matching/exact-duplicates.js";

let nextInode = 1;

function makeRecord(overrides: {
  id: string;
  relativePath: string;
  sha256: string;
  sizeBytes?: number;
  inode?: number;
  device?: number;
}): ImageRecord {
  return {
    id: overrides.id,
    path: overrides.relativePath,
    realPath: `/input/${overrides.relativePath}`,
    relativePath: overrides.relativePath,
    file: {
      sizeBytes: overrides.sizeBytes ?? 1000,
      modifiedAt: "2026-01-01T00:00:00.000Z",
      sha256: overrides.sha256,
      inode: overrides.inode ?? nextInode++,
      device: overrides.device ?? 1,
    },
    image: {
      format: "jpeg",
      width: 100,
      height: 100,
      aspectRatio: 1,
      pages: 1,
      hasAlpha: false,
    },
    metadata: {
      exifPresent: false,
      iptcPresent: false,
      xmpPresent: false,
      iccPresent: false,
    },
    hashes: { sha256: overrides.sha256 },
    quality: {},
    warnings: [],
  };
}

describe("computeExactDuplicateGroups", () => {
  it("groups records with identical SHA-256 and leaves unique files ungrouped", () => {
    const records = [
      makeRecord({ id: "a", relativePath: "a.jpg", sha256: "hash1" }),
      makeRecord({ id: "b", relativePath: "b.jpg", sha256: "hash1" }),
      makeRecord({ id: "c", relativePath: "c.jpg", sha256: "hash2" }),
    ];

    const result = computeExactDuplicateGroups(records, []);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.members.sort()).toEqual(["a", "b"]);
    expect(result.groups[0]?.kind).toBe("exact-duplicate");
  });

  it("produces deterministic, content-derived group ids regardless of input order", () => {
    const records = [
      makeRecord({ id: "a", relativePath: "a.jpg", sha256: "aaaa111122223333" }),
      makeRecord({ id: "b", relativePath: "b.jpg", sha256: "aaaa111122223333" }),
    ];

    const forward = computeExactDuplicateGroups(records, []);
    const reversed = computeExactDuplicateGroups([...records].reverse(), []);

    expect(forward.groups[0]?.id).toBe(reversed.groups[0]?.id);
    expect(forward.groups[0]?.id).toMatch(/^grp_/);
  });

  it("marks a group manual-review with no path preferences configured", () => {
    const records = [
      makeRecord({ id: "a", relativePath: "a.jpg", sha256: "hash1" }),
      makeRecord({ id: "b", relativePath: "b.jpg", sha256: "hash1" }),
    ];

    const result = computeExactDuplicateGroups(records, []);

    expect(result.groups[0]?.status).toBe("manual-review");
    expect(result.groups[0]?.recommendedOriginalId).toBeUndefined();
    expect(result.groups[0]?.confidence).toBe(0);
  });

  it("recommends the path favoured by an unambiguous path preference", () => {
    const records = [
      makeRecord({ id: "a", relativePath: "public/generated/a.jpg", sha256: "hash1" }),
      makeRecord({ id: "b", relativePath: "backups/originals/a.jpg", sha256: "hash1" }),
    ];

    const result = computeExactDuplicateGroups(records, [
      { pattern: "backups/originals/**", weight: 20 },
      { pattern: "public/generated/**", weight: -20 },
    ]);

    expect(result.groups[0]?.status).toBe("automatic");
    expect(result.groups[0]?.recommendedOriginalId).toBe("b");
    expect(result.groups[0]?.confidence).toBe(1);
  });

  it("falls back to manual-review when path preferences tie", () => {
    const records = [
      makeRecord({ id: "a", relativePath: "archive-1/a.jpg", sha256: "hash1" }),
      makeRecord({ id: "b", relativePath: "archive-2/a.jpg", sha256: "hash1" }),
    ];

    const result = computeExactDuplicateGroups(records, [
      { pattern: "archive-1/**", weight: 10 },
      { pattern: "archive-2/**", weight: 10 },
    ]);

    expect(result.groups[0]?.status).toBe("manual-review");
    expect(result.groups[0]?.warnings.some((w) => w.includes("tie"))).toBe(true);
  });

  it("computes wasted bytes as (member count - 1) * file size, per group and in total", () => {
    const records = [
      makeRecord({ id: "a", relativePath: "a.jpg", sha256: "hash1", sizeBytes: 500 }),
      makeRecord({ id: "b", relativePath: "b.jpg", sha256: "hash1", sizeBytes: 500 }),
      makeRecord({ id: "c", relativePath: "c.jpg", sha256: "hash1", sizeBytes: 500 }),
      makeRecord({ id: "d", relativePath: "d.jpg", sha256: "hash2", sizeBytes: 300 }),
      makeRecord({ id: "e", relativePath: "e.jpg", sha256: "hash2", sizeBytes: 300 }),
    ];

    const result = computeExactDuplicateGroups(records, []);

    expect(result.wastedBytes).toBe(500 * 2 + 300 * 1);
    expect(Object.values(result.wastedBytesByGroup).sort((a, b) => a - b)).toEqual([300, 1000]);
  });

  it("detects hard links (same device + inode) separately from ordinary duplicates", () => {
    const records = [
      makeRecord({ id: "a", relativePath: "a.jpg", sha256: "hash1", inode: 42, device: 1 }),
      makeRecord({ id: "b", relativePath: "b.jpg", sha256: "hash1", inode: 42, device: 1 }),
      makeRecord({ id: "c", relativePath: "c.jpg", sha256: "hash1", inode: 99, device: 1 }),
    ];

    const result = computeExactDuplicateGroups(records, []);

    expect(result.hardLinkClusters).toEqual([["a", "b"]]);
    expect(result.groups[0]?.warnings.some((w) => w.includes("hard link"))).toBe(true);
  });

  it("does not produce a group for a file with no duplicates", () => {
    const records = [makeRecord({ id: "a", relativePath: "a.jpg", sha256: "hash1" })];
    const result = computeExactDuplicateGroups(records, []);
    expect(result.groups).toHaveLength(0);
    expect(result.wastedBytes).toBe(0);
  });
});
