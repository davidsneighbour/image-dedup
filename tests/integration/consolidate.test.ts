import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CliError, ExitCode } from "../../src/cli/exit-codes.js";
import { Logger } from "../../src/cli/output.js";
import { resolveDefaultConfig } from "../../src/config/defaults.js";
import type { ImageOriginConfig } from "../../src/config/schema.js";
import { rollbackConsolidation } from "../../src/consolidation/rollback-consolidation.js";
import { runConsolidation } from "../../src/consolidation/run-consolidation.js";
import { runAudit } from "../../src/discovery/run-audit.js";
import { canonicalManifestSchema } from "../../src/domain/manifest.js";
import { openDatabase } from "../../src/persistence/database.js";
import { listImageRecords } from "../../src/persistence/repositories/image-records.js";
import { listOperationsForRun } from "../../src/persistence/repositories/operations.js";
import { type FixtureTree, buildFixtureTree } from "./helpers/build-fixture-tree.js";

function silentLogger(): Logger {
  return new Logger({ level: "quiet" });
}

async function sha256OfFile(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

describe("consolidation (M10)", () => {
  let fixture: FixtureTree;
  let workspace: string;
  let originalsDirectory: string;
  let config: ImageOriginConfig;

  beforeEach(async () => {
    fixture = await buildFixtureTree();
    workspace = join(fixture.root, ".image-origin");
    originalsDirectory = await mkdtemp(join(tmpdir(), "image-origin-originals-"));

    config = resolveDefaultConfig([fixture.inputDir]);
    config.workspace = workspace;
    config.originalsDirectory = originalsDirectory;
    // Makes the fixture's one exact-duplicate group (red.jpg / backups/originals/red-copy.jpg)
    // resolve automatically instead of landing in manual-review, matching PLAN.md §4's own
    // example config — required for it to be eligible for consolidation at all.
    config.pathPreferences = [{ pattern: "backups/originals/**", weight: 10 }];

    await runAudit({ config, logger: silentLogger(), force: false });
  });

  afterEach(async () => {
    await fixture.cleanup();
    await rm(originalsDirectory, { recursive: true, force: true });
  });

  it("dry run writes a manifest preview without copying anything or touching operations", async () => {
    const result = await runConsolidation({ config, apply: false, logger: silentLogger() });

    expect(result.runId).toBeUndefined();
    expect(result.operations).toEqual([]);
    expect(result.unresolvedGroupIds).toEqual([]);
    // 1 exact-duplicate winner + every other discovered image, standalone.
    expect(result.planned.length).toBeGreaterThan(1);

    const preview = JSON.parse(await readFile(result.manifestPreviewPath, "utf8"));
    expect(canonicalManifestSchema.safeParse(preview).success).toBe(true);
    expect(preview.images.length).toBe(result.planned.length);

    await expect(readdir(originalsDirectory)).resolves.toEqual([]);
  });

  it("apply copies every planned file, verifies hashes, and writes the canonical manifest", async () => {
    const result = await runConsolidation({ config, apply: true, logger: silentLogger() });

    expect(result.runId).toBeDefined();
    expect(result.failedOperations).toEqual([]);
    expect(result.operations).toHaveLength(result.planned.length);
    expect(result.operations.every((op) => op.status === "verified")).toBe(true);

    for (const entry of result.planned) {
      const destinationHash = await sha256OfFile(entry.canonicalPath);
      expect(destinationHash).toBe(entry.sourceSha256);
    }

    expect(result.manifestPath).toBe(join(originalsDirectory, "manifest.json"));
    const manifest = JSON.parse(await readFile(result.manifestPath as string, "utf8"));
    expect(canonicalManifestSchema.safeParse(manifest).success).toBe(true);
    expect(manifest.images).toHaveLength(result.planned.length);

    const journalPath = join(workspace, "journal", `${result.runId}.json`);
    const journal = JSON.parse(await readFile(journalPath, "utf8"));
    expect(journal).toHaveLength(result.planned.length);

    const db = await openDatabase(workspace);
    try {
      const persisted = listOperationsForRun(db, result.runId as string);
      expect(persisted).toHaveLength(result.planned.length);
      expect(persisted.every((op) => op.status === "verified")).toBe(true);
    } finally {
      db.close();
    }
  });

  it("fails safely on a second apply once destinations already exist, without recording new operations", async () => {
    const first = await runConsolidation({ config, apply: true, logger: silentLogger() });

    let caught: unknown;
    try {
      await runConsolidation({ config, apply: true, logger: silentLogger() });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CliError);
    expect((caught as CliError).exitCode).toBe(ExitCode.unsafeOperationRefused);

    const db = await openDatabase(workspace);
    try {
      const persisted = listOperationsForRun(db, first.runId as string);
      expect(persisted).toHaveLength(first.planned.length);
    } finally {
      db.close();
    }
  });

  it("reports collisions with a reviewRequired exit code under the manual-review policy", async () => {
    await runConsolidation({ config, apply: true, logger: silentLogger() });

    config.consolidation.collisionPolicy = "manual-review";
    let caught: unknown;
    try {
      await runConsolidation({ config, apply: false, logger: silentLogger() });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CliError);
    expect((caught as CliError).exitCode).toBe(ExitCode.reviewRequired);
  });

  it("rolls back a run: dry run reports without removing, --apply removes verified copies", async () => {
    const result = await runConsolidation({ config, apply: true, logger: silentLogger() });
    const runId = result.runId as string;

    const dryRun = await rollbackConsolidation({
      workspace,
      runId,
      apply: false,
      logger: silentLogger(),
    });
    expect(dryRun.removed).toHaveLength(result.planned.length);
    expect(dryRun.skipped).toEqual([]);
    for (const entry of result.planned) {
      await expect(readFile(entry.canonicalPath)).resolves.toBeDefined();
    }

    const applied = await rollbackConsolidation({
      workspace,
      runId,
      apply: true,
      logger: silentLogger(),
    });
    expect(applied.removed).toHaveLength(result.planned.length);
    for (const entry of result.planned) {
      await expect(readFile(entry.canonicalPath)).rejects.toThrow();
    }

    const db = await openDatabase(workspace);
    try {
      const persisted = listOperationsForRun(db, runId);
      expect(persisted.every((op) => op.status === "rolled-back")).toBe(true);
    } finally {
      db.close();
    }
  });

  it("excludes groups that have not been reviewed yet, reporting them as unresolved", async () => {
    config.pathPreferences = []; // no preference -> the exact-duplicate group is left as manual-review

    const workspaceB = await mkdtemp(join(tmpdir(), "image-origin-ws-"));
    const configB = { ...config, workspace: workspaceB };
    await runAudit({ config: configB, logger: silentLogger(), force: false });

    const db = await openDatabase(workspaceB);
    let totalRecords: number;
    try {
      totalRecords = listImageRecords(db).length;
    } finally {
      db.close();
    }

    const result = await runConsolidation({
      config: configB,
      apply: false,
      logger: silentLogger(),
    });

    expect(result.unresolvedGroupIds).toHaveLength(1);
    // Both members of the unresolved exact-duplicate group are excluded
    // entirely (neither copied under its own id, nor subsumed as a
    // winner's selectedFrom) — every other record still gets planned.
    expect(result.planned).toHaveLength(totalRecords - 2);

    await rm(workspaceB, { recursive: true, force: true });
  });
});
