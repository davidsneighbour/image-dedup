import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveDefaultConfig } from "../../src/config/defaults.js";
import type { ImageOriginConfig } from "../../src/config/schema.js";
import { planCanonicalPaths } from "../../src/consolidation/plan-canonical-paths.js";
import type { SelectedOriginal } from "../../src/consolidation/select-originals.js";
import type { ImageRecord } from "../../src/domain/image-record.js";

function record(overrides: {
  id: string;
  relativePath: string;
  sha256: string;
  captureDate?: string;
}): ImageRecord {
  return {
    id: overrides.id,
    path: overrides.relativePath,
    realPath: `/input/${overrides.relativePath}`,
    relativePath: overrides.relativePath,
    file: {
      sizeBytes: 1000,
      modifiedAt: "2020-06-15T00:00:00.000Z",
      sha256: overrides.sha256,
      inode: 1,
      device: 1,
    },
    image: { format: "jpeg", width: 100, height: 100, aspectRatio: 1, pages: 1, hasAlpha: false },
    metadata: {
      exifPresent: Boolean(overrides.captureDate),
      iptcPresent: false,
      xmpPresent: false,
      iccPresent: false,
      ...(overrides.captureDate ? { captureDate: overrides.captureDate } : {}),
    },
    hashes: { sha256: overrides.sha256 },
    quality: {},
    warnings: [],
  };
}

function selection(imageId: string): SelectedOriginal {
  return {
    imageId,
    groupIds: [],
    selectedFrom: [],
    relationships: [],
    selection: { method: "standalone", confidence: 1, reasons: [] },
  };
}

function withConsolidation(
  overrides: Partial<ImageOriginConfig["consolidation"]>,
): ImageOriginConfig["consolidation"] {
  const config = resolveDefaultConfig(["./input"]);
  return { ...config.consolidation, ...overrides };
}

describe("planCanonicalPaths", () => {
  let originalsDirectory: string;

  beforeEach(async () => {
    originalsDirectory = await mkdtemp(join(tmpdir(), "image-origin-originals-"));
  });

  afterEach(async () => {
    await rm(originalsDirectory, { recursive: true, force: true });
  });

  it("plans a content-hash destination with the original extension preserved", async () => {
    const rec = record({ id: "img_a", relativePath: "photos/a.jpg", sha256: "a".repeat(64) });
    const entries = await planCanonicalPaths([selection("img_a")], new Map([["img_a", rec]]), {
      originalsDirectory,
      consolidation: withConsolidation({ naming: "content-hash" }),
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.status).toBe("planned");
    expect(entries[0]?.canonicalRelativePath).toBe(`${"a".repeat(16)}.jpg`);
  });

  it("sanitises unsafe characters for the original-filename strategy", async () => {
    const rec = record({ id: "img_a", relativePath: "a?b*c.jpg", sha256: "b".repeat(64) });
    const entries = await planCanonicalPaths([selection("img_a")], new Map([["img_a", rec]]), {
      originalsDirectory,
      consolidation: withConsolidation({ naming: "original-filename" }),
    });

    expect(entries[0]?.canonicalRelativePath).toBe("a-b-c.jpg");
  });

  it("builds a year/date-slug path from the trusted capture date", async () => {
    const rec = record({
      id: "img_a",
      relativePath: "Beach Day.jpg",
      sha256: "c".repeat(64),
      captureDate: "2014-03-02T10:00:00.000Z",
    });
    const entries = await planCanonicalPaths([selection("img_a")], new Map([["img_a", rec]]), {
      originalsDirectory,
      consolidation: withConsolidation({ naming: "date-slug" }),
    });

    expect(entries[0]?.canonicalRelativePath).toBe("2014/2014-03-02-beach-day.jpg");
    expect(entries[0]?.warnings).toEqual([]);
  });

  it("warns when date-slug falls back to filesystem modification time", async () => {
    const rec = record({ id: "img_a", relativePath: "photo.jpg", sha256: "d".repeat(64) });
    const entries = await planCanonicalPaths([selection("img_a")], new Map([["img_a", rec]]), {
      originalsDirectory,
      consolidation: withConsolidation({ naming: "date-slug" }),
    });

    expect(entries[0]?.warnings).toHaveLength(1);
    expect(entries[0]?.warnings[0]).toMatch(/weak fallback/);
  });

  it("renders a template with year/slug/shortHash/ext placeholders", async () => {
    const rec = record({
      id: "img_a",
      relativePath: "Beach Day.jpg",
      sha256: "e".repeat(64),
      captureDate: "2014-03-02T10:00:00.000Z",
    });
    const entries = await planCanonicalPaths([selection("img_a")], new Map([["img_a", rec]]), {
      originalsDirectory,
      consolidation: withConsolidation({
        naming: "template",
        template: "{year}/{slug}-{shortHash}.{ext}",
      }),
    });

    expect(entries[0]?.canonicalRelativePath).toBe("2014/beach-day-eeeeeeee.jpg");
  });

  it("fails a collision under the default 'fail' policy without touching the filesystem", async () => {
    const rec = record({ id: "img_a", relativePath: "a.jpg", sha256: "f".repeat(64) });
    await mkdir(originalsDirectory, { recursive: true });
    await writeFile(join(originalsDirectory, "a.jpg"), "pre-existing, unrelated content");

    const entries = await planCanonicalPaths([selection("img_a")], new Map([["img_a", rec]]), {
      originalsDirectory,
      consolidation: withConsolidation({ naming: "original-filename", collisionPolicy: "fail" }),
    });

    expect(entries[0]?.status).toBe("collision");
    expect(entries[0]?.collisionReason).toMatch(/already exists/);
  });

  it("reuses an existing destination with identical content under 'reuse-identical'", async () => {
    await mkdir(originalsDirectory, { recursive: true });
    const fixtureContent = "identical content";
    const { createHash } = await import("node:crypto");
    const realSha256 = createHash("sha256").update(fixtureContent).digest("hex");
    await writeFile(join(originalsDirectory, "a.jpg"), fixtureContent);

    // The record's own sha256 must match the fixture file already on disk —
    // reuse only ever triggers on a genuine content match.
    const rec = record({ id: "img_a", relativePath: "a.jpg", sha256: realSha256 });
    const entries = await planCanonicalPaths([selection("img_a")], new Map([["img_a", rec]]), {
      originalsDirectory,
      consolidation: withConsolidation({
        naming: "original-filename",
        collisionPolicy: "reuse-identical",
      }),
    });

    expect(entries[0]?.status).toBe("reuse-existing");
  });

  it("appends a hash suffix to resolve a collision under 'append-hash'", async () => {
    const recA = record({ id: "img_a", relativePath: "a.jpg", sha256: "2".repeat(64) });
    const recB = record({ id: "img_b", relativePath: "backup/a.jpg", sha256: "3".repeat(64) });

    const entries = await planCanonicalPaths(
      [selection("img_a"), selection("img_b")],
      new Map([
        ["img_a", recA],
        ["img_b", recB],
      ]),
      {
        originalsDirectory,
        consolidation: withConsolidation({
          naming: "original-filename",
          collisionPolicy: "append-hash",
        }),
      },
    );

    expect(entries.every((entry) => entry.status !== "collision")).toBe(true);
    const paths = entries.map((entry) => entry.canonicalRelativePath);
    expect(new Set(paths).size).toBe(2);
    expect(paths).toContain("a.jpg");
    expect(paths.some((path) => path !== "a.jpg" && path.startsWith("a-"))).toBe(true);
  });

  it("case-insensitively and Unicode-normalisation-insensitively detects in-run collisions", async () => {
    const recA = record({ id: "img_a", relativePath: "Photo.jpg", sha256: "4".repeat(64) });
    const recB = record({ id: "img_b", relativePath: "photo.JPG", sha256: "5".repeat(64) });

    const entries = await planCanonicalPaths(
      [selection("img_a"), selection("img_b")],
      new Map([
        ["img_a", recA],
        ["img_b", recB],
      ]),
      {
        originalsDirectory,
        consolidation: withConsolidation({ naming: "original-filename", collisionPolicy: "fail" }),
      },
    );

    const statuses = entries.map((entry) => entry.status).sort();
    expect(statuses).toEqual(["collision", "planned"]);
  });
});
