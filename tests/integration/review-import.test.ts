import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CliError, ExitCode } from "../../src/cli/exit-codes.js";
import { Logger } from "../../src/cli/output.js";
import { resolveDefaultConfig } from "../../src/config/defaults.js";
import { runAudit } from "../../src/discovery/run-audit.js";
import type { ReviewDecision } from "../../src/domain/review-decision.js";
import { openDatabase } from "../../src/persistence/database.js";
import { listAllGroups, updateGroup } from "../../src/persistence/repositories/groups.js";
import { generateReport } from "../../src/reporting/generate-report.js";
import { readDecisionsFile } from "../../src/review/decisions-file.js";
import { importReviewDecisions } from "../../src/review/import-decisions.js";
import { type FixtureTree, buildFixtureTree } from "./helpers/build-fixture-tree.js";

function silentLogger(): Logger {
  return new Logger({ level: "quiet" });
}

describe("importReviewDecisions", () => {
  let fixture: FixtureTree;
  let workspace: string;
  let decisionsPath: string;
  let exactDuplicateGroupId: string;
  let members: [string, string];

  beforeEach(async () => {
    fixture = await buildFixtureTree();
    workspace = join(fixture.root, ".image-origin");
    decisionsPath = join(fixture.root, "decisions.json");

    const config = resolveDefaultConfig([fixture.inputDir]);
    config.workspace = workspace;

    await runAudit({ config, logger: silentLogger(), force: false });
    const { report } = await generateReport({
      config,
      logger: silentLogger(),
      absolutePaths: false,
      pretty: false,
    });

    const group = report.groups.find((g) => g.kind === "exact-duplicate");
    if (!group || group.members.length !== 2) {
      throw new Error("fixture did not produce the expected 2-member exact-duplicate group");
    }
    exactDuplicateGroupId = group.id;
    members = [group.members[0] as string, group.members[1] as string];
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  async function writeDecisions(decisions: ReviewDecision[]): Promise<void> {
    await writeFile(decisionsPath, JSON.stringify(decisions), "utf8");
  }

  it("applies a valid select-different decision and persists it to the workspace", async () => {
    await writeDecisions([
      {
        groupId: exactDuplicateGroupId,
        action: "select-different",
        selectedImageId: members[1],
        selectedAt: "2026-08-01T00:00:00.000Z",
        note: "prefer the backup copy",
      },
    ]);

    const result = await importReviewDecisions({
      workspace,
      decisionsPath,
      forceStaleDecisions: false,
      logger: silentLogger(),
    });

    expect(result.totalDecisions).toBe(1);
    expect(result.applied).toHaveLength(1);
    expect(result.skippedStale).toEqual([]);

    const db = await openDatabase(workspace);
    let updatedGroup: ReturnType<typeof listAllGroups>[number] | undefined;
    try {
      updatedGroup = listAllGroups(db).find((g) => g.id === exactDuplicateGroupId);
    } finally {
      db.close();
    }
    expect(updatedGroup?.status).toBe("approved");
    expect(updatedGroup?.recommendedOriginalId).toBe(members[1]);
    expect(updatedGroup?.reasons.at(-1)).toContain("prefer the backup copy");

    const persistedDecisions = await readDecisionsFile(workspace);
    expect(persistedDecisions).toHaveLength(1);
    expect(persistedDecisions[0]?.groupId).toBe(exactDuplicateGroupId);
  });

  it("rejects a decision referencing a nonexistent group without applying anything", async () => {
    await writeDecisions([
      {
        groupId: "grp_does_not_exist",
        action: "not-related",
        selectedAt: "2026-08-01T00:00:00.000Z",
      },
    ]);

    await expect(
      importReviewDecisions({
        workspace,
        decisionsPath,
        forceStaleDecisions: false,
        logger: silentLogger(),
      }),
    ).rejects.toMatchObject({ exitCode: ExitCode.invalidConfiguration });

    expect(await readDecisionsFile(workspace)).toEqual([]);
  });

  it("rejects conflicting duplicate decisions for the same group", async () => {
    await writeDecisions([
      {
        groupId: exactDuplicateGroupId,
        action: "not-related",
        selectedAt: "2026-08-01T00:00:00.000Z",
      },
      {
        groupId: exactDuplicateGroupId,
        action: "keep-multiple",
        selectedAt: "2026-08-01T00:00:01.000Z",
      },
    ]);

    await expect(
      importReviewDecisions({
        workspace,
        decisionsPath,
        forceStaleDecisions: false,
        logger: silentLogger(),
      }),
    ).rejects.toMatchObject({ exitCode: ExitCode.invalidConfiguration });
  });

  it("refuses stale decisions (group membership changed since the report) without --force-stale-decisions", async () => {
    // Simulate a re-scan that changed this group's membership after
    // `report` wrote audit.json, without regenerating the report — the
    // live DB and the snapshot now disagree.
    const db = await openDatabase(workspace);
    try {
      const live = listAllGroups(db).find((g) => g.id === exactDuplicateGroupId);
      if (!live) throw new Error("group vanished");
      updateGroup(db, { ...live, members: [...live.members, "img_extra"] });
    } finally {
      db.close();
    }

    await writeDecisions([
      {
        groupId: exactDuplicateGroupId,
        action: "not-related",
        selectedAt: "2026-08-01T00:00:00.000Z",
      },
    ]);

    let caught: unknown;
    try {
      await importReviewDecisions({
        workspace,
        decisionsPath,
        forceStaleDecisions: false,
        logger: silentLogger(),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CliError);
    expect((caught as CliError).exitCode).toBe(ExitCode.unsafeOperationRefused);
    expect(await readDecisionsFile(workspace)).toEqual([]);
  });

  it("applies a stale decision when --force-stale-decisions is given and the selection is still valid live", async () => {
    const db = await openDatabase(workspace);
    try {
      const live = listAllGroups(db).find((g) => g.id === exactDuplicateGroupId);
      if (!live) throw new Error("group vanished");
      updateGroup(db, { ...live, members: [...live.members, "img_extra"] });
    } finally {
      db.close();
    }

    await writeDecisions([
      {
        groupId: exactDuplicateGroupId,
        action: "not-related",
        selectedAt: "2026-08-01T00:00:00.000Z",
      },
    ]);

    const result = await importReviewDecisions({
      workspace,
      decisionsPath,
      forceStaleDecisions: true,
      logger: silentLogger(),
    });

    expect(result.applied).toHaveLength(1);
    expect(result.skippedStale).toEqual([]);

    const db2 = await openDatabase(workspace);
    let updatedGroup: ReturnType<typeof listAllGroups>[number] | undefined;
    try {
      updatedGroup = listAllGroups(db2).find((g) => g.id === exactDuplicateGroupId);
    } finally {
      db2.close();
    }
    expect(updatedGroup?.status).toBe("rejected");
  });
});
