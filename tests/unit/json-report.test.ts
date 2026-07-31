import { describe, expect, it } from "vitest";
import { resolveDefaultConfig } from "../../src/config/defaults.js";
import type { ImageGroup } from "../../src/domain/image-group.js";
import type { ImageRecord } from "../../src/domain/image-record.js";
import {
  assertValidJsonReport,
  buildJsonReport,
  computeConfigFingerprint,
} from "../../src/reporting/json-report.js";

function record(overrides: Partial<ImageRecord> & { id: string }): ImageRecord {
  return {
    id: overrides.id,
    path: overrides.path ?? `${overrides.id}.jpg`,
    realPath: overrides.realPath ?? `/abs/input/${overrides.id}.jpg`,
    relativePath: overrides.relativePath ?? `${overrides.id}.jpg`,
    file: {
      sizeBytes: 1000,
      modifiedAt: "2026-01-01T00:00:00.000Z",
      sha256: overrides.file?.sha256 ?? "a".repeat(64),
      inode: 1,
      device: 1,
      ...overrides.file,
    },
    image: {
      format: "jpeg",
      width: 100,
      height: 100,
      aspectRatio: 1,
      pages: 1,
      hasAlpha: false,
      ...overrides.image,
    },
    metadata: {
      exifPresent: false,
      iptcPresent: false,
      xmpPresent: false,
      iccPresent: false,
      ...overrides.metadata,
    },
    hashes: { sha256: overrides.file?.sha256 ?? "a".repeat(64), ...overrides.hashes },
    quality: { ...overrides.quality },
    warnings: overrides.warnings ?? [],
  };
}

function group(overrides: Partial<ImageGroup> & { id: string; members: string[] }): ImageGroup {
  return {
    id: overrides.id,
    kind: overrides.kind ?? "exact-duplicate",
    members: overrides.members,
    comparisons: overrides.comparisons ?? [],
    confidence: overrides.confidence ?? 1,
    status: overrides.status ?? "automatic",
    reasons: overrides.reasons ?? [],
    warnings: overrides.warnings ?? [],
    ...(overrides.recommendedOriginalId
      ? { recommendedOriginalId: overrides.recommendedOriginalId }
      : {}),
    ...(overrides.score !== undefined ? { score: overrides.score } : {}),
  };
}

describe("buildJsonReport", () => {
  const config = resolveDefaultConfig(["/abs/input"]);

  it("produces a report that satisfies its own schema", () => {
    const records = [
      record({ id: "img_b", relativePath: "b.jpg" }),
      record({ id: "img_a", relativePath: "a.jpg" }),
    ];
    const groups = [group({ id: "grp_1", members: ["img_a", "img_b"] })];

    const report = buildJsonReport({
      config,
      records,
      groups,
      errors: [],
      toolVersion: "0.1.0",
      absolutePaths: false,
    });

    expect(() => assertValidJsonReport(report)).not.toThrow();
  });

  it("orders images by path and groups by id regardless of input order", () => {
    const records = [
      record({ id: "img_z", relativePath: "z.jpg" }),
      record({ id: "img_a", relativePath: "a.jpg" }),
      record({ id: "img_m", relativePath: "m.jpg" }),
    ];
    const groups = [
      group({ id: "grp_z", members: ["img_z", "img_a"] }),
      group({ id: "grp_a", members: ["img_a", "img_m"] }),
    ];

    const report = buildJsonReport({
      config,
      records,
      groups,
      errors: [],
      toolVersion: "0.1.0",
      absolutePaths: false,
    });

    expect(report.images.map((i) => i.path)).toEqual(["a.jpg", "m.jpg", "z.jpg"]);
    expect(report.groups.map((g) => g.id)).toEqual(["grp_a", "grp_z"]);
  });

  it("never includes absolutePath unless absolutePaths is requested", () => {
    const records = [record({ id: "img_a", realPath: "/abs/input/a.jpg" })];
    const groups = [group({ id: "grp_1", members: ["img_a", "img_a"] })];

    const withoutAbsolute = buildJsonReport({
      config,
      records,
      groups,
      errors: [],
      toolVersion: "0.1.0",
      absolutePaths: false,
    });
    expect(withoutAbsolute.images[0]?.absolutePath).toBeUndefined();

    const withAbsolute = buildJsonReport({
      config,
      records,
      groups,
      errors: [],
      toolVersion: "0.1.0",
      absolutePaths: true,
    });
    expect(withAbsolute.images[0]?.absolutePath).toBe("/abs/input/a.jpg");
  });

  it("counts groups by kind and status in the summary", () => {
    const records = [record({ id: "img_a" }), record({ id: "img_b" }), record({ id: "img_c" })];
    const groups = [
      group({ id: "grp_1", kind: "exact-duplicate", members: ["img_a", "img_b"] }),
      group({
        id: "grp_2",
        kind: "visual",
        members: ["img_b", "img_c"],
        status: "manual-review",
      }),
      group({ id: "grp_3", kind: "visual", members: ["img_a", "img_c"], status: "ambiguous" }),
    ];

    const report = buildJsonReport({
      config,
      records,
      groups,
      errors: [],
      toolVersion: "0.1.0",
      absolutePaths: false,
    });

    expect(report.summary.exactDuplicateGroups).toBe(1);
    expect(report.summary.visualGroups).toBe(2);
    expect(report.summary.manualReviewGroups).toBe(1);
    expect(report.summary.ambiguousGroups).toBe(1);
    expect(report.summary.automaticRecommendations).toBe(1);
  });

  it("produces the same config fingerprint for identical configs and a different one for different configs", () => {
    const otherConfig = resolveDefaultConfig(["/abs/other-input"]);
    expect(computeConfigFingerprint(config)).toBe(computeConfigFingerprint(config));
    expect(computeConfigFingerprint(config)).not.toBe(computeConfigFingerprint(otherConfig));
  });

  it("attaches asset paths only for the records they were generated for", () => {
    const records = [record({ id: "img_a" }), record({ id: "img_b" })];
    const groups = [group({ id: "grp_1", members: ["img_a", "img_b"] })];
    const assetsByRecordId = new Map([["img_a", { thumbnail: "assets/thumbnails/x.webp" }]]);

    const report = buildJsonReport({
      config,
      records,
      groups,
      errors: [],
      toolVersion: "0.1.0",
      absolutePaths: false,
      assetsByRecordId,
    });

    const imgA = report.images.find((i) => i.id === "img_a");
    const imgB = report.images.find((i) => i.id === "img_b");
    expect(imgA?.assets?.thumbnail).toBe("assets/thumbnails/x.webp");
    expect(imgB?.assets).toBeUndefined();
  });
});
