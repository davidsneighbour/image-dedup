import { randomUUID } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CliError, ExitCode } from "../cli/exit-codes.js";
import type { Logger } from "../cli/output.js";
import { readPackageVersion } from "../cli/package-version.js";
import type { ImageOriginConfig } from "../config/schema.js";
import type { ImageGroup } from "../domain/image-group.js";
import type { ImageRecord } from "../domain/image-record.js";
import type { ConsolidationOperation } from "../domain/operation.js";
import { openDatabase } from "../persistence/database.js";
import { listGroupsOfKind } from "../persistence/repositories/groups.js";
import { listImageRecords } from "../persistence/repositories/image-records.js";
import { insertOperation } from "../persistence/repositories/operations.js";
import { buildCanonicalManifest } from "./build-manifest.js";
import { copyAndVerifyEntry } from "./copy-and-verify.js";
import { writeJournalFile } from "./journal-file.js";
import { type CanonicalPathPlanEntry, planCanonicalPaths } from "./plan-canonical-paths.js";
import { selectOriginals } from "./select-originals.js";

export interface RunConsolidationOptions {
  config: ImageOriginConfig;
  apply: boolean;
  logger: Logger;
}

export interface RunConsolidationResult {
  /** Only set when `apply` was true. */
  runId?: string;
  originalsDirectory: string;
  planned: CanonicalPathPlanEntry[];
  unresolvedGroupIds: string[];
  manifestPreviewPath: string;
  manifestPath?: string;
  operations: ConsolidationOperation[];
  failedOperations: ConsolidationOperation[];
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs one consolidation pass (PLAN.md §23): select originals, plan
 * canonical paths, write the manifest preview, and — only when `apply` is
 * true — copy, verify, journal, and write the final manifest. Collisions
 * always abort the whole run before any file is copied (PLAN.md: "no
 * mutation without --apply" and "collisions fail safely" both require
 * this to be all-or-nothing up front, not a partial copy followed by an
 * error partway through).
 */
export async function runConsolidation(
  options: RunConsolidationOptions,
): Promise<RunConsolidationResult> {
  const { config, apply, logger } = options;

  if (!config.originalsDirectory) {
    throw new CliError(
      "Consolidation requires an originals directory.",
      ExitCode.invalidConfiguration,
      'Pass --originals <path> or set "originalsDirectory" in the config file.',
    );
  }
  const originalsDirectory = resolve(config.originalsDirectory);

  const databasePath = join(config.workspace, "database.sqlite");
  if (!(await pathExists(databasePath))) {
    throw new CliError(
      `No audit workspace found at "${config.workspace}".`,
      ExitCode.commandFailed,
      "Run `image-origin audit` first to populate the workspace.",
    );
  }

  const db = await openDatabase(config.workspace);
  let groups: ImageGroup[];
  let records: ImageRecord[];
  try {
    groups = [...listGroupsOfKind(db, "exact-duplicate"), ...listGroupsOfKind(db, "visual")];
    records = listImageRecords(db);
  } finally {
    db.close();
  }

  const recordsById = new Map(records.map((record) => [record.id, record]));
  const { selected, unresolvedGroupIds } = selectOriginals(groups, records);

  if (unresolvedGroupIds.length > 0) {
    logger.warn(
      `${unresolvedGroupIds.length} group(s) have not been reviewed yet and are excluded from this run: ${unresolvedGroupIds.join(", ")}.`,
    );
  }

  const planEntries = await planCanonicalPaths(selected, recordsById, {
    originalsDirectory,
    consolidation: config.consolidation,
  });
  const collisions = planEntries.filter((entry) => entry.status === "collision");
  const plannedEntries = planEntries.filter((entry) => entry.status !== "collision");

  const toolVersion = readPackageVersion();

  const manifestPreview = buildCanonicalManifest({
    entries: plannedEntries,
    recordsById,
    toolVersion,
  });
  const manifestPreviewPath = join(config.workspace, "manifest.preview.json");
  await mkdir(config.workspace, { recursive: true });
  await writeFile(manifestPreviewPath, `${JSON.stringify(manifestPreview, null, 2)}\n`, "utf8");

  logger.info("Consolidation plan");
  logger.info(`  ${plannedEntries.length} image(s) planned for "${originalsDirectory}"`);
  if (collisions.length > 0) {
    logger.info(`  ${collisions.length} collision(s) require attention`);
  }

  if (collisions.length > 0) {
    const policy = config.consolidation.collisionPolicy;
    const exitCode =
      policy === "manual-review" ? ExitCode.reviewRequired : ExitCode.unsafeOperationRefused;
    throw new CliError(
      `Consolidation plan has ${collisions.length} unresolved collision(s):\n${collisions
        .map((entry) => `  - ${entry.canonicalRelativePath}: ${entry.collisionReason}`)
        .join("\n")}`,
      exitCode,
      policy === "manual-review"
        ? "Resolve these paths (rename or move the conflicting files) and re-run. No files were copied."
        : 'Change consolidation.collisionPolicy (e.g. to "append-hash" or "manual-review"), or resolve the conflicting destination paths, then re-run. No files were copied.',
    );
  }

  if (!apply) {
    logger.info("Dry run: no files were copied. Re-run with --apply to copy files.");
    return {
      originalsDirectory,
      planned: plannedEntries,
      unresolvedGroupIds,
      manifestPreviewPath,
      operations: [],
      failedOperations: [],
    };
  }

  const runId = `run_${new Date().toISOString().replace(/[^0-9]/g, "")}_${randomUUID().slice(0, 8)}`;

  const operations: ConsolidationOperation[] = [];
  const failedOperations: ConsolidationOperation[] = [];

  const applyDb = await openDatabase(config.workspace);
  try {
    for (const entry of plannedEntries) {
      const result = await copyAndVerifyEntry(entry, runId);
      operations.push(result.operation);
      insertOperation(applyDb, result.operation);

      if (result.operation.status === "failed") {
        failedOperations.push(result.operation);
        logger.error({
          phase: "consolidate",
          filePath: entry.sourceRelativePath,
          operation: "copy",
          error: result.error ?? "copy failed",
          continued: true,
        });
      } else {
        logger.verbose(`${entry.sourceRelativePath} -> ${entry.canonicalRelativePath}`);
      }
    }
  } finally {
    applyDb.close();
  }

  await writeJournalFile(config.workspace, runId, operations);

  let manifestPath: string | undefined;
  if (config.consolidation.writeManifest) {
    const failedDestinations = new Set(failedOperations.map((op) => op.destination));
    const successfulEntries = plannedEntries.filter(
      (entry) => !failedDestinations.has(entry.canonicalPath),
    );
    const manifest = buildCanonicalManifest({
      entries: successfulEntries,
      recordsById,
      toolVersion,
    });
    manifestPath = join(originalsDirectory, "manifest.json");
    await mkdir(originalsDirectory, { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }

  logger.info(
    `Consolidation run ${runId}: ${operations.length - failedOperations.length} verified, ${failedOperations.length} failed.`,
  );
  if (failedOperations.length > 0) {
    logger.warn(
      `${failedOperations.length} file(s) failed copy verification and were left out of the manifest. Run \`consolidate rollback --run ${runId}\` to undo the rest of this run if needed.`,
    );
  }

  return {
    runId,
    originalsDirectory,
    planned: plannedEntries,
    unresolvedGroupIds,
    manifestPreviewPath,
    ...(manifestPath ? { manifestPath } : {}),
    operations,
    failedOperations,
  };
}
