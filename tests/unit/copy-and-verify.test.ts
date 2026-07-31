import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyAndVerifyEntry } from "../../src/consolidation/copy-and-verify.js";
import type { CanonicalPathPlanEntry } from "../../src/consolidation/plan-canonical-paths.js";
import type { SelectedOriginal } from "../../src/consolidation/select-originals.js";

function selection(): SelectedOriginal {
  return {
    imageId: "img_a",
    groupIds: [],
    selectedFrom: [],
    relationships: [],
    selection: { method: "standalone", confidence: 1, reasons: [] },
  };
}

describe("copyAndVerifyEntry", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "image-origin-copy-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("copies the file and verifies the destination hash matches", async () => {
    const sourcePath = join(root, "source.jpg");
    await writeFile(sourcePath, "hello world");
    const sha256 = createHash("sha256").update("hello world").digest("hex");
    const destination = join(root, "out", "dest.jpg");

    const entry: CanonicalPathPlanEntry = {
      imageId: "img_a",
      sourcePath,
      sourceRelativePath: "source.jpg",
      sourceSha256: sha256,
      canonicalRelativePath: "dest.jpg",
      canonicalPath: destination,
      status: "planned",
      warnings: [],
      selection: selection(),
    };

    const result = await copyAndVerifyEntry(entry, "run_test");

    expect(result.error).toBeUndefined();
    expect(result.operation.status).toBe("verified");
    expect(result.operation.destinationHash).toBe(sha256);
    expect(await readFile(destination, "utf8")).toBe("hello world");
  });

  it("fails without copying when the source has changed since the audit ran", async () => {
    const sourcePath = join(root, "source.jpg");
    await writeFile(sourcePath, "changed content");
    const destination = join(root, "dest.jpg");

    const entry: CanonicalPathPlanEntry = {
      imageId: "img_a",
      sourcePath,
      sourceRelativePath: "source.jpg",
      sourceSha256: "0".repeat(64), // stale — doesn't match the live file
      canonicalRelativePath: "dest.jpg",
      canonicalPath: destination,
      status: "planned",
      warnings: [],
      selection: selection(),
    };

    const result = await copyAndVerifyEntry(entry, "run_test");

    expect(result.operation.status).toBe("failed");
    expect(result.error).toMatch(/changed since the audit/);
    await expect(readFile(destination)).rejects.toThrow();
  });

  it("returns skipped-identical without touching the filesystem for a reuse-existing entry", async () => {
    const entry: CanonicalPathPlanEntry = {
      imageId: "img_a",
      sourcePath: join(root, "source.jpg"),
      sourceRelativePath: "source.jpg",
      sourceSha256: "1".repeat(64),
      canonicalRelativePath: "dest.jpg",
      canonicalPath: join(root, "dest.jpg"),
      status: "reuse-existing",
      warnings: [],
      selection: selection(),
    };

    const result = await copyAndVerifyEntry(entry, "run_test");

    expect(result.operation.status).toBe("skipped-identical");
    expect(result.operation.destinationHash).toBe("1".repeat(64));
  });
});
