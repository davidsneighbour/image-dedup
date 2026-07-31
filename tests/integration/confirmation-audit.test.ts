import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Logger } from "../../src/cli/output.js";
import { resolveDefaultConfig } from "../../src/config/defaults.js";
import { runAudit } from "../../src/discovery/run-audit.js";
import { openDatabase } from "../../src/persistence/database.js";
import { listComparisons } from "../../src/persistence/repositories/comparisons.js";
import { listGroupsOfKind } from "../../src/persistence/repositories/groups.js";
import { listImageRecords } from "../../src/persistence/repositories/image-records.js";
import {
  type ConfirmationFixtureTree,
  buildConfirmationFixtureTree,
} from "./helpers/build-confirmation-fixture-tree.js";

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

describe("runAudit confirmation and relationship classification", () => {
  let fixture: ConfirmationFixtureTree;

  beforeEach(async () => {
    fixture = await buildConfirmationFixtureTree();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("classifies resize, format-conversion, recompression, and rotation relationships correctly", async () => {
    const workspace = join(fixture.root, ".image-origin");
    const config = resolveDefaultConfig([fixture.inputDir]);
    config.workspace = workspace;

    await runAudit({ config, logger: silentLogger(), force: false });

    const db = await openDatabase(workspace);
    try {
      const records = listImageRecords(db);
      const originalId = idFor(records, "original.jpg");
      const resizedId = idFor(records, "resized.jpg");
      const convertedId = idFor(records, "converted.webp");
      const recompressedId = idFor(records, "recompressed.jpg");
      const rotatedId = idFor(records, "rotated.jpg");
      const unrelatedId = idFor(records, "unrelated.jpg");

      const comparisons = listComparisons(db);
      const relationshipFor = (x: string, y: string) => {
        const found = comparisons.find((c) => (c.a === x && c.b === y) || (c.a === y && c.b === x));
        return found?.relationship;
      };

      expect(relationshipFor(originalId, resizedId)).toBe("resize");
      expect(relationshipFor(originalId, convertedId)).toBe("format-conversion");
      expect(relationshipFor(originalId, recompressedId)).toBe("recompression");
      expect(relationshipFor(originalId, rotatedId)).toBe("rotation");

      // The unrelated image must never be classified as related to the
      // original, whether because it never became an M4 candidate at all
      // or because M5 confirmation rejected it.
      const unrelatedRelationship = relationshipFor(originalId, unrelatedId);
      expect(unrelatedRelationship === undefined || unrelatedRelationship === "unknown").toBe(true);

      const visualGroups = listGroupsOfKind(db, "visual");
      const groupContainingOriginal = visualGroups.find((group) =>
        group.members.includes(originalId),
      );
      expect(groupContainingOriginal).toBeDefined();
      expect(groupContainingOriginal?.members).not.toContain(unrelatedId);
      // M5 never recommends an original — that needs M7's scoring.
      expect(groupContainingOriginal?.recommendedOriginalId).toBeUndefined();
      expect(groupContainingOriginal?.status).not.toBe("automatic");
    } finally {
      db.close();
    }
  });

  it("persists every classified pair, confirmed or not, so uncertain pairs are visible rather than silently dropped", async () => {
    const workspace = join(fixture.root, ".image-origin");
    const config = resolveDefaultConfig([fixture.inputDir]);
    config.workspace = workspace;

    const result = await runAudit({ config, logger: silentLogger(), force: false });

    expect(result.confirmedRelationships).toBeGreaterThanOrEqual(4);

    const db = await openDatabase(workspace);
    try {
      const comparisons = listComparisons(db);
      expect(comparisons.length).toBe(result.confirmedRelationships + result.unconfirmedPairs);
      for (const comparison of comparisons) {
        expect(comparison.reasons.length + comparison.warnings.length).toBeGreaterThan(0);
      }
    } finally {
      db.close();
    }
  });
});
