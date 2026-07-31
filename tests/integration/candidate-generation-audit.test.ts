import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Logger } from "../../src/cli/output.js";
import { resolveDefaultConfig } from "../../src/config/defaults.js";
import { runAudit } from "../../src/discovery/run-audit.js";
import { openDatabase } from "../../src/persistence/database.js";
import { listCandidatePairs } from "../../src/persistence/repositories/candidate-pairs.js";
import { listImageRecords } from "../../src/persistence/repositories/image-records.js";
import {
  type PerceptualFixtureTree,
  buildPerceptualFixtureTree,
} from "./helpers/build-perceptual-fixture-tree.js";

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

describe("runAudit perceptual candidate generation", () => {
  let fixture: PerceptualFixtureTree;

  beforeEach(async () => {
    fixture = await buildPerceptualFixtureTree();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("pairs a resized derivative and a format-converted derivative with their source, but not an unrelated image", async () => {
    const workspace = join(fixture.root, ".image-origin");
    const config = resolveDefaultConfig([fixture.inputDir]);
    config.workspace = workspace;

    const result = await runAudit({ config, logger: silentLogger(), force: false });

    expect(result.hashesComputed).toBe(4);
    expect(result.perceptualCandidatePairs).toBeGreaterThanOrEqual(2);

    const db = await openDatabase(workspace);
    try {
      const records = listImageRecords(db);
      for (const record of records) {
        expect(record.hashes.difference).toMatch(/^[0-9a-f]{16}$/);
        expect(record.hashes.perceptual).toMatch(/^[0-9a-f]{16}$/);
      }

      const originalId = idFor(records, "original.jpg");
      const resizedId = idFor(records, "resized.jpg");
      const convertedId = idFor(records, "converted.webp");
      const unrelatedId = idFor(records, "unrelated.jpg");

      const pairs = listCandidatePairs(db);
      const pairIds = new Set(pairs.map((p) => `${p.a}:${p.b}`));
      const hasPair = (x: string, y: string) => pairIds.has(x < y ? `${x}:${y}` : `${y}:${x}`);

      expect(hasPair(originalId, resizedId)).toBe(true);
      expect(hasPair(originalId, convertedId)).toBe(true);
      expect(hasPair(originalId, unrelatedId)).toBe(false);
      expect(hasPair(resizedId, unrelatedId)).toBe(false);
      expect(hasPair(convertedId, unrelatedId)).toBe(false);
    } finally {
      db.close();
    }
  });

  it("reuses cached hashes and does not recompute candidates unnecessarily on a second run", async () => {
    const workspace = join(fixture.root, ".image-origin");
    const config = resolveDefaultConfig([fixture.inputDir]);
    config.workspace = workspace;

    const first = await runAudit({ config, logger: silentLogger(), force: false });
    const second = await runAudit({ config, logger: silentLogger(), force: false });

    expect(second.hashesComputed).toBe(0);
    expect(second.hashesReused).toBe(first.hashesComputed);
    expect(second.perceptualCandidatePairs).toBe(first.perceptualCandidatePairs);
  });

  it("skips perceptual matching entirely when disabled in config", async () => {
    const workspace = join(fixture.root, ".image-origin");
    const config = resolveDefaultConfig([fixture.inputDir]);
    config.workspace = workspace;
    config.matching.perceptualHash = false;

    const result = await runAudit({ config, logger: silentLogger(), force: false });

    expect(result.hashesComputed).toBe(0);
    expect(result.perceptualCandidatePairs).toBe(0);

    const db = await openDatabase(workspace);
    try {
      expect(listCandidatePairs(db)).toHaveLength(0);
    } finally {
      db.close();
    }
  });
});
