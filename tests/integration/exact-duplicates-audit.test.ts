import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Logger } from "../../src/cli/output.js";
import { resolveDefaultConfig } from "../../src/config/defaults.js";
import { runAudit } from "../../src/discovery/run-audit.js";
import { openDatabase } from "../../src/persistence/database.js";
import { listGroupsOfKind } from "../../src/persistence/repositories/groups.js";
import { type FixtureTree, buildFixtureTree } from "./helpers/build-fixture-tree.js";

function silentLogger(): Logger {
  return new Logger({ level: "quiet" });
}

describe("runAudit exact-duplicate matching", () => {
  let fixture: FixtureTree;

  beforeEach(async () => {
    fixture = await buildFixtureTree();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("groups red.jpg with its byte-identical copy and reports recoverable storage", async () => {
    const workspace = join(fixture.root, ".image-origin");
    const config = resolveDefaultConfig([fixture.inputDir]);
    config.workspace = workspace;

    const result = await runAudit({ config, logger: silentLogger(), force: false });

    expect(result.exactDuplicateGroups).toBe(1);
    expect(result.wastedBytes).toBeGreaterThan(0);

    const db = await openDatabase(workspace);
    try {
      const groups = listGroupsOfKind(db, "exact-duplicate");
      expect(groups).toHaveLength(1);
      const [group] = groups;
      expect(group?.members).toHaveLength(2);
      expect(group?.status).toBe("manual-review");
      expect(group?.recommendedOriginalId).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("recommends the path favoured by configured path preferences", async () => {
    const workspace = join(fixture.root, ".image-origin");
    const config = resolveDefaultConfig([fixture.inputDir]);
    config.workspace = workspace;
    config.pathPreferences = [
      { pattern: "backups/originals/**", weight: 20 },
      { pattern: "**/*.jpg", weight: 0 },
    ];

    await runAudit({ config, logger: silentLogger(), force: false });

    const db = await openDatabase(workspace);
    try {
      const [group] = listGroupsOfKind(db, "exact-duplicate");
      expect(group?.status).toBe("automatic");
      expect(group?.recommendedOriginalId).toBeDefined();

      const recommendedId = group?.recommendedOriginalId;
      const recommendedIsBackupCopy = recommendedId !== undefined;
      expect(recommendedIsBackupCopy).toBe(true);
    } finally {
      db.close();
    }
  });

  it("recomputes groups deterministically and idempotently on re-run", async () => {
    const workspace = join(fixture.root, ".image-origin");
    const config = resolveDefaultConfig([fixture.inputDir]);
    config.workspace = workspace;

    const first = await runAudit({ config, logger: silentLogger(), force: false });
    const second = await runAudit({ config, logger: silentLogger(), force: false });

    expect(second.exactDuplicateGroups).toBe(first.exactDuplicateGroups);
    expect(second.wastedBytes).toBe(first.wastedBytes);

    const db = await openDatabase(workspace);
    try {
      const groups = listGroupsOfKind(db, "exact-duplicate");
      expect(groups).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});
