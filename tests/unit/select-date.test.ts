import { describe, expect, it } from "vitest";
import { selectDate } from "../../src/consolidation/select-date.js";
import type { ImageRecord } from "../../src/domain/image-record.js";

function record(overrides: { captureDate?: string; modifiedAt?: string }): ImageRecord {
  return {
    id: "img_a",
    path: "a.jpg",
    realPath: "/input/a.jpg",
    relativePath: "a.jpg",
    file: {
      sizeBytes: 1000,
      modifiedAt: overrides.modifiedAt ?? "2020-05-01T00:00:00.000Z",
      sha256: "hash",
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
    hashes: { sha256: "hash" },
    quality: {},
    warnings: [],
  };
}

describe("selectDate", () => {
  it("prefers the trusted metadata capture date when present", () => {
    const result = selectDate(
      record({ captureDate: "2014-03-02T10:00:00.000Z", modifiedAt: "2026-01-01T00:00:00.000Z" }),
    );
    expect(result.source).toBe("metadata-capture-date");
    expect(result.date?.toISOString()).toBe("2014-03-02T10:00:00.000Z");
  });

  it("falls back to filesystem modification time, flagged as a weak fallback", () => {
    const result = selectDate(record({ modifiedAt: "2020-05-01T00:00:00.000Z" }));
    expect(result.source).toBe("filesystem-modified-weak");
    expect(result.date?.toISOString()).toBe("2020-05-01T00:00:00.000Z");
  });

  it("ignores an unparseable capture date and falls back", () => {
    const result = selectDate(record({ captureDate: "not-a-date" }));
    expect(result.source).toBe("filesystem-modified-weak");
  });

  it("reports unknown-date when nothing is parseable", () => {
    const result = selectDate(record({ modifiedAt: "not-a-date" }));
    expect(result.source).toBe("unknown-date");
    expect(result.date).toBeUndefined();
  });
});
