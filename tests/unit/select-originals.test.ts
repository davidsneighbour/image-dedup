import { describe, expect, it } from "vitest";
import { selectOriginals } from "../../src/consolidation/select-originals.js";
import type { ImageGroup } from "../../src/domain/image-group.js";
import type { ImageRecord } from "../../src/domain/image-record.js";

function record(id: string, relativePath: string): ImageRecord {
  return {
    id,
    path: relativePath,
    realPath: `/input/${relativePath}`,
    relativePath,
    file: {
      sizeBytes: 1000,
      modifiedAt: "2026-01-01T00:00:00.000Z",
      sha256: `sha-${id}`,
      inode: 1,
      device: 1,
    },
    image: { format: "jpeg", width: 100, height: 100, aspectRatio: 1, pages: 1, hasAlpha: false },
    metadata: { exifPresent: false, iptcPresent: false, xmpPresent: false, iccPresent: false },
    hashes: { sha256: `sha-${id}` },
    quality: {},
    warnings: [],
  };
}

function group(overrides: Partial<ImageGroup> & { id: string; members: string[] }): ImageGroup {
  return {
    kind: "visual",
    comparisons: [],
    confidence: 0.9,
    status: "automatic",
    reasons: ["reason"],
    warnings: [],
    ...overrides,
  };
}

describe("selectOriginals", () => {
  it("selects the recommended winner of an automatic group and records losers as selectedFrom", () => {
    const records = [record("img_a", "a.jpg"), record("img_b", "backups/a-copy.jpg")];
    const groups: ImageGroup[] = [
      group({
        id: "grp_1",
        members: ["img_a", "img_b"],
        recommendedOriginalId: "img_a",
        status: "automatic",
        kind: "exact-duplicate",
      }),
    ];

    const { selected, unresolvedGroupIds } = selectOriginals(groups, records);

    expect(unresolvedGroupIds).toEqual([]);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.imageId).toBe("img_a");
    expect(selected[0]?.selectedFrom).toEqual(["backups/a-copy.jpg"]);
    expect(selected[0]?.selection.method).toBe("automatic");
  });

  it("excludes manual-review/ambiguous groups entirely, reporting them as unresolved", () => {
    const records = [record("img_a", "a.jpg"), record("img_b", "b.jpg")];
    const groups: ImageGroup[] = [
      group({ id: "grp_1", members: ["img_a", "img_b"], status: "manual-review" }),
    ];

    const { selected, unresolvedGroupIds } = selectOriginals(groups, records);

    expect(selected).toEqual([]);
    expect(unresolvedGroupIds).toEqual(["grp_1"]);
  });

  it("treats every member of a keep-multiple (approved, no recommendation) group as independent", () => {
    const records = [record("img_a", "a.jpg"), record("img_b", "b.jpg")];
    const groups: ImageGroup[] = [
      group({ id: "grp_1", members: ["img_a", "img_b"], status: "approved" }),
    ];

    const { selected } = selectOriginals(groups, records);

    expect(selected.map((s) => s.imageId).sort()).toEqual(["img_a", "img_b"]);
    for (const entry of selected) {
      expect(entry.selection.method).toBe("manual");
      expect(entry.selectedFrom).toEqual([]);
    }
  });

  it("treats every member of a rejected (not-related) group as an independent standalone", () => {
    const records = [record("img_a", "a.jpg"), record("img_b", "b.jpg")];
    const groups: ImageGroup[] = [
      group({ id: "grp_1", members: ["img_a", "img_b"], status: "rejected" }),
    ];

    const { selected } = selectOriginals(groups, records);

    expect(selected.map((s) => s.imageId).sort()).toEqual(["img_a", "img_b"]);
    for (const entry of selected) {
      expect(entry.selection.method).toBe("standalone");
    }
  });

  it("includes images that were never part of any group as standalone originals", () => {
    const records = [record("img_a", "a.jpg")];

    const { selected } = selectOriginals([], records);

    expect(selected).toHaveLength(1);
    expect(selected[0]?.selection.method).toBe("standalone");
    expect(selected[0]?.groupIds).toEqual([]);
  });

  it("lets exact-duplicate subsumption override a keep-multiple decision for the same image", () => {
    // img_b loses to img_a in an exact-duplicate group (byte-identical) but
    // is also a member of a separate, unrelated keep-multiple group.
    // Subsumption must win: copying img_b again would just duplicate img_a's bytes.
    const records = [record("img_a", "a.jpg"), record("img_b", "b.jpg"), record("img_c", "c.jpg")];
    const groups: ImageGroup[] = [
      group({
        id: "grp_exact",
        kind: "exact-duplicate",
        members: ["img_a", "img_b"],
        recommendedOriginalId: "img_a",
        status: "automatic",
      }),
      group({
        id: "grp_keep",
        kind: "visual",
        members: ["img_b", "img_c"],
        status: "approved",
      }),
    ];

    const { selected } = selectOriginals(groups, records);

    expect(selected.map((s) => s.imageId).sort()).toEqual(["img_a", "img_c"]);
  });

  it("merges provenance when the same winner is recommended by two different groups", () => {
    const records = [record("img_a", "a.jpg"), record("img_b", "b.jpg"), record("img_c", "c.jpg")];
    const groups: ImageGroup[] = [
      group({
        id: "grp_1",
        members: ["img_a", "img_b"],
        recommendedOriginalId: "img_a",
        status: "automatic",
      }),
      group({
        id: "grp_2",
        members: ["img_a", "img_c"],
        recommendedOriginalId: "img_a",
        status: "approved",
      }),
    ];

    const { selected } = selectOriginals(groups, records);

    expect(selected).toHaveLength(1);
    expect(selected[0]?.groupIds.sort()).toEqual(["grp_1", "grp_2"]);
    expect(selected[0]?.selectedFrom.sort()).toEqual(["b.jpg", "c.jpg"]);
  });
});
