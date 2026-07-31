import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Logger } from "../../src/cli/output.js";
import { resolveDefaultConfig } from "../../src/config/defaults.js";
import { runAudit } from "../../src/discovery/run-audit.js";
import { openDatabase } from "../../src/persistence/database.js";
import { listComparisons } from "../../src/persistence/repositories/comparisons.js";
import { listImageRecords } from "../../src/persistence/repositories/image-records.js";
import {
  type CropUpscaleFixtureTree,
  buildCropUpscaleFixtureTree,
} from "./helpers/build-crop-upscale-fixture-tree.js";

function silentLogger(): Logger {
  return new Logger({ level: "quiet" });
}

function idFor(records: ReturnType<typeof listImageRecords>, suffix: string): string {
  const record = records.find((r) => r.path.endsWith(suffix));
  if (!record) {
    throw new Error(`fixture record ending in "${suffix}" not found`);
  }
  return record.id;
}

describe("runAudit crop and upscale detection", () => {
  let fixture: CropUpscaleFixtureTree;

  beforeEach(async () => {
    fixture = await buildCropUpscaleFixtureTree();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("detects the known crop fixture and preserves it rather than discarding it", async () => {
    const workspace = join(fixture.root, ".image-origin");
    const config = resolveDefaultConfig([fixture.inputDir]);
    config.workspace = workspace;

    const result = await runAudit({ config, logger: silentLogger(), force: false });

    expect(result.cropsDetected).toBeGreaterThanOrEqual(1);

    const db = await openDatabase(workspace);
    try {
      const records = listImageRecords(db);
      const originalId = idFor(records, "original.png");
      const cropId = idFor(records, "crop.png");

      const comparisons = listComparisons(db);
      const cropComparison = comparisons.find(
        (c) => (c.a === originalId && c.b === cropId) || (c.a === cropId && c.b === originalId),
      );

      expect(cropComparison).toBeDefined();
      expect(cropComparison?.relationship).toBe("crop");
      const details = cropComparison?.details as
        | { cropBox?: unknown; retainedArea?: number }
        | undefined;
      expect(details?.cropBox).toBeDefined();
      expect(details?.retainedArea).toBeGreaterThan(0);

      // Both files must still exist as independent, untouched records —
      // detecting a crop never deletes or merges anything (PLAN.md §12.3).
      expect(records.some((r) => r.id === originalId)).toBe(true);
      expect(records.some((r) => r.id === cropId)).toBe(true);
    } finally {
      db.close();
    }
  });

  it("flags a naive upscale as probableUpscale but not a genuine higher-resolution source", async () => {
    const workspace = join(fixture.root, ".image-origin");
    const config = resolveDefaultConfig([fixture.inputDir]);
    config.workspace = workspace;

    const result = await runAudit({ config, logger: silentLogger(), force: false });

    expect(result.probableUpscalesDetected).toBeGreaterThanOrEqual(1);

    const db = await openDatabase(workspace);
    try {
      const records = listImageRecords(db);
      const fakeUpscaledRecord = records.find((r) => r.path.endsWith("fake-upscaled.png"));
      const genuineLargeRecord = records.find((r) => r.path.endsWith("genuine-large.png"));

      expect(fakeUpscaledRecord?.quality.probableUpscale).toBe(true);
      // The genuine higher-resolution source must not be penalised —
      // it's either untouched (undefined) or explicitly false.
      expect(genuineLargeRecord?.quality.probableUpscale).not.toBe(true);

      // No automatic deletion or rejection: every fixture file is still present.
      expect(records).toHaveLength(6);
    } finally {
      db.close();
    }
  });
});
