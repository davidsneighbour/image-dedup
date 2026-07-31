import { describe, expect, it } from "vitest";
import { buildCanonicalManifest } from "../../src/consolidation/build-manifest.js";
import type { CanonicalPathPlanEntry } from "../../src/consolidation/plan-canonical-paths.js";
import type { ImageRecord } from "../../src/domain/image-record.js";
import { canonicalManifestSchema } from "../../src/domain/manifest.js";

function record(id: string): ImageRecord {
  return {
    id,
    path: `${id}.jpg`,
    realPath: `/input/${id}.jpg`,
    relativePath: `${id}.jpg`,
    file: {
      sizeBytes: 1000,
      modifiedAt: "2020-01-01T00:00:00.000Z",
      sha256: "a".repeat(64),
      inode: 1,
      device: 1,
    },
    image: { format: "jpeg", width: 100, height: 100, aspectRatio: 1, pages: 1, hasAlpha: false },
    metadata: { exifPresent: false, iptcPresent: false, xmpPresent: false, iccPresent: false },
    hashes: { sha256: "a".repeat(64) },
    quality: {},
    warnings: [],
  };
}

function entry(
  overrides: Partial<CanonicalPathPlanEntry> & { imageId: string },
): CanonicalPathPlanEntry {
  return {
    sourcePath: `/input/${overrides.imageId}.jpg`,
    sourceRelativePath: `${overrides.imageId}.jpg`,
    sourceSha256: "a".repeat(64),
    canonicalRelativePath: `${overrides.imageId}.jpg`,
    canonicalPath: `/originals/${overrides.imageId}.jpg`,
    status: "planned",
    warnings: [],
    selection: {
      imageId: overrides.imageId,
      groupIds: [],
      selectedFrom: [],
      relationships: [],
      selection: { method: "standalone", confidence: 1, reasons: ["no relationship detected"] },
    },
    ...overrides,
  };
}

describe("buildCanonicalManifest", () => {
  it("produces a schema-valid manifest sorted by canonical path", () => {
    const recordsById = new Map([
      ["img_b", record("img_b")],
      ["img_a", record("img_a")],
    ]);
    const entries = [
      entry({ imageId: "img_b", canonicalRelativePath: "b.jpg" }),
      entry({ imageId: "img_a", canonicalRelativePath: "a.jpg" }),
    ];

    const manifest = buildCanonicalManifest({ entries, recordsById, toolVersion: "0.1.0" });

    expect(manifest.images.map((image) => image.canonicalPath)).toEqual(["a.jpg", "b.jpg"]);
    expect(canonicalManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it("silently skips an entry with no matching record", () => {
    const manifest = buildCanonicalManifest({
      entries: [entry({ imageId: "img_missing" })],
      recordsById: new Map(),
      toolVersion: "0.1.0",
    });

    expect(manifest.images).toEqual([]);
  });

  it("carries selectedFrom/relationships/selection through from the plan entry", () => {
    const recordsById = new Map([["img_a", record("img_a")]]);
    const entries = [
      entry({
        imageId: "img_a",
        selection: {
          imageId: "img_a",
          groupIds: ["grp_1"],
          selectedFrom: ["backup/a-copy.jpg"],
          relationships: [{ path: "backup/a-copy.jpg", type: "exact-duplicate", confidence: 1 }],
          selection: { method: "automatic", confidence: 1, reasons: ["identical content"] },
        },
      }),
    ];

    const manifest = buildCanonicalManifest({ entries, recordsById, toolVersion: "0.1.0" });

    expect(manifest.images[0]?.selectedFrom).toEqual(["backup/a-copy.jpg"]);
    expect(manifest.images[0]?.relationships).toEqual([
      { path: "backup/a-copy.jpg", type: "exact-duplicate", confidence: 1 },
    ]);
    expect(manifest.images[0]?.selection.method).toBe("automatic");
  });
});
