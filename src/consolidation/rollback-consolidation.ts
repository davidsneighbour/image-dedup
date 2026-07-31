import { unlink } from "node:fs/promises";
import { CliError, ExitCode } from "../cli/exit-codes.js";
import type { Logger } from "../cli/output.js";
import type { ConsolidationOperation } from "../domain/operation.js";
import { sha256File } from "../inventory/exact-hash.js";
import { openDatabase } from "../persistence/database.js";
import {
  findMostRecentRunId,
  listOperationsForDestination,
  listOperationsForRun,
  markOperationRolledBack,
} from "../persistence/repositories/operations.js";

export interface RollbackConsolidationOptions {
  workspace: string;
  /** Defaults to the most recently started run in this workspace. */
  runId?: string;
  /** Without this, only reports what *would* be removed (PLAN.md §23.2: mutations require --apply). */
  apply: boolean;
  logger: Logger;
}

export interface RollbackSkip {
  operation: ConsolidationOperation;
  reason: string;
}

export interface RollbackConsolidationResult {
  runId: string;
  removed: ConsolidationOperation[];
  skipped: RollbackSkip[];
}

/**
 * Undoes the copies made by one consolidation run (PLAN.md §23.4). Only
 * ever removes files this tool created — source files are never touched
 * by any command in this tool. Three independent safety checks gate every
 * removal, all required by PLAN.md §23.4:
 *
 * 1. the operation actually completed a copy (`status === "verified"`;
 *    `"skipped-identical"` didn't create the file, `"failed"` didn't
 *    leave a trustworthy one behind, and `"rolled-back"` is already gone);
 * 2. the destination's *current* content hash still matches what this
 *    run wrote there — if it's been modified or replaced since, removing
 *    it could destroy someone else's work;
 * 3. no later run's journal also recorded an operation against the same
 *    destination (a subsequent `consolidate --apply` re-verified or
 *    reused that exact path) — removing it would break that later run's
 *    manifest out from under it.
 */
export async function rollbackConsolidation(
  options: RollbackConsolidationOptions,
): Promise<RollbackConsolidationResult> {
  const { workspace, apply, logger } = options;

  const db = await openDatabase(workspace);
  try {
    const runId = options.runId ?? findMostRecentRunId(db);
    if (!runId) {
      throw new CliError(
        "No consolidation runs are recorded in this workspace.",
        ExitCode.commandFailed,
      );
    }

    const runOperations = listOperationsForRun(db, runId);
    if (runOperations.length === 0) {
      throw new CliError(
        `No operations found for run "${runId}".`,
        ExitCode.commandFailed,
        "Check the run id against `<workspace>/journal/*.json` or the operations recorded by previous `consolidate --apply` runs.",
      );
    }

    const removed: ConsolidationOperation[] = [];
    const skipped: RollbackSkip[] = [];

    for (const operation of runOperations) {
      if (operation.status !== "verified") {
        skipped.push({
          operation,
          reason: `operation status is "${operation.status}", not a completed copy that needs removing`,
        });
        continue;
      }

      const laterOperations = listOperationsForDestination(db, operation.destination).filter(
        (other) => other.runId !== runId && other.timestamp > operation.timestamp,
      );
      if (laterOperations.length > 0) {
        skipped.push({
          operation,
          reason: `a later consolidation run (${laterOperations[0]?.runId}) also depends on this destination; roll that run back first if you need this file gone`,
        });
        continue;
      }

      let currentHash: string;
      try {
        currentHash = await sha256File(operation.destination);
      } catch {
        skipped.push({ operation, reason: "destination file no longer exists" });
        continue;
      }

      if (currentHash !== operation.destinationHash) {
        skipped.push({
          operation,
          reason:
            "destination file has changed since this run created it; refusing to remove content that may not be this tool's own copy anymore",
        });
        continue;
      }

      if (apply) {
        await unlink(operation.destination);
        markOperationRolledBack(db, operation.operationId, new Date().toISOString());
        logger.verbose(`Removed ${operation.destination}`);
      }
      removed.push(operation);
    }

    if (!apply) {
      logger.info(
        `Dry run: ${removed.length} file(s) would be removed for run "${runId}". Re-run with --apply to remove them.`,
      );
    } else {
      logger.info(`Rolled back run "${runId}": removed ${removed.length} file(s).`);
    }
    if (skipped.length > 0) {
      logger.warn(`${skipped.length} operation(s) from this run were left untouched:`);
      for (const skip of skipped) {
        logger.warn(`  ${skip.operation.destination}: ${skip.reason}`);
      }
    }

    return { runId, removed, skipped };
  } finally {
    db.close();
  }
}
