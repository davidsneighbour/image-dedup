import { stat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Logger } from "../../src/cli/output.js";
import { resolveDefaultConfig } from "../../src/config/defaults.js";
import { runAudit } from "../../src/discovery/run-audit.js";
import { inspectImage } from "../../src/inventory/inspect-image.js";
import { openDatabase } from "../../src/persistence/database.js";
import { listScanErrors } from "../../src/persistence/repositories/errors.js";
import {
  countImageRecords,
  listImageRecords,
  upsertImageRecord,
} from "../../src/persistence/repositories/image-records.js";
import { type FixtureTree, buildFixtureTree } from "./helpers/build-fixture-tree.js";

function silentLogger(): Logger {
  return new Logger({ level: "quiet" });
}

describe("runAudit", () => {
  let fixture: FixtureTree;

  beforeEach(async () => {
    fixture = await buildFixtureTree();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("inventories every discovered image and records the corrupted file as a non-fatal error", async () => {
    const workspace = join(fixture.root, ".image-origin");
    const config = resolveDefaultConfig([fixture.inputDir]);
    config.workspace = workspace;

    const result = await runAudit({ config, logger: silentLogger(), force: false });

    // red.jpg, blue.png, green.webp, yellow.gif, .hidden.jpg, UPPER.JPG, corrupted.jpg (fails at inventory)
    expect(result.discovered).toBeGreaterThanOrEqual(6);
    expect(result.errors).toBeGreaterThanOrEqual(1);

    const db = await openDatabase(workspace);
    try {
      const errors = listScanErrors(db);
      expect(errors.some((error) => error.filePath?.includes("corrupted.jpg"))).toBe(true);

      const records = listImageRecords(db);
      expect(records.find((record) => record.path.endsWith("red.jpg"))).toBeDefined();
      const redRecord = records.find((record) => record.path.endsWith("red.jpg"));
      expect(redRecord?.image.format).toBe("jpeg");
      expect(redRecord?.image.width).toBe(32);
      expect(redRecord?.file.sha256).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      db.close();
    }
  });

  it("reuses cached records on a second run and only recomputes when forced", async () => {
    const workspace = join(fixture.root, ".image-origin");
    const config = resolveDefaultConfig([fixture.inputDir]);
    config.workspace = workspace;

    const first = await runAudit({ config, logger: silentLogger(), force: false });
    expect(first.inspected).toBeGreaterThan(0);

    const second = await runAudit({ config, logger: silentLogger(), force: false });
    expect(second.inspected).toBe(0);
    expect(second.reusedFromCache).toBe(first.inspected);

    const forced = await runAudit({ config, logger: silentLogger(), force: true });
    expect(forced.inspected).toBe(first.inspected);
    expect(forced.reusedFromCache).toBe(0);

    const db = await openDatabase(workspace);
    try {
      expect(countImageRecords(db)).toBe(first.inspected);
    } finally {
      db.close();
    }
  });

  it("resumes an interrupted run: files already persisted before a crash are not reprocessed", async () => {
    const workspace = join(fixture.root, ".image-origin");
    const config = resolveDefaultConfig([fixture.inputDir]);
    config.workspace = workspace;

    // Simulate a crash partway through a scan: one file's record already
    // made it to the database (as `runAudit` persists each record as soon
    // as it's inspected, not in a single end-of-run batch), the rest never
    // got there.
    const redPath = join(fixture.inputDir, "red.jpg");
    const preScanned = await inspectImage({
      realPath: redPath,
      path: redPath,
      relativePath: "red.jpg",
      maxInputPixels: config.limits.maxInputPixels,
    });
    const db = await openDatabase(workspace);
    upsertImageRecord(db, preScanned);
    db.close();

    const resumed = await runAudit({ config, logger: silentLogger(), force: false });

    // The pre-scanned file must be reused from cache, not re-inspected.
    const redStats = await stat(redPath);
    expect(preScanned.file.modifiedAt).toBe(redStats.mtime.toISOString());
    expect(resumed.reusedFromCache).toBeGreaterThanOrEqual(1);
    expect(resumed.inspected).toBeLessThan(resumed.discovered);
  });
});
