import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CliError, ExitCode } from "../cli/exit-codes.js";
import { formatZodError } from "../cli/format-zod-error.js";
import type { Logger } from "../cli/output.js";
import { type ImageGroup, imageGroupSchema } from "../domain/image-group.js";
import { type ReviewDecision, reviewDecisionsSchema } from "../domain/review-decision.js";
import { openDatabase } from "../persistence/database.js";
import { listAllGroups, updateGroup } from "../persistence/repositories/groups.js";
import { jsonReportSchema } from "../reporting/json-report.js";
import { applyDecisionToGroup } from "./apply-decision.js";
import { mergeDecisions, readDecisionsFile, writeDecisionsFile } from "./decisions-file.js";
import { type DecisionIssue, validateDecisions } from "./validate-decisions.js";

export interface ImportReviewDecisionsOptions {
  workspace: string;
  decisionsPath: string;
  forceStaleDecisions: boolean;
  logger: Logger;
}

export interface ImportReviewDecisionsResult {
  totalDecisions: number;
  applied: ReviewDecision[];
  skippedStale: DecisionIssue[];
}

async function readJsonFile(path: string, whatFor: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new CliError(
      `Could not read ${whatFor} at "${path}": ${(error as Error).message}`,
      ExitCode.commandFailed,
    );
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new CliError(
      `${whatFor} at "${path}" is not valid JSON: ${(error as Error).message}`,
      ExitCode.invalidConfiguration,
    );
  }
}

function formatIssues(issues: readonly DecisionIssue[]): string {
  return issues.map((issue) => `  - ${issue.groupId}: ${issue.reason}`).join("\n");
}

/**
 * Validates and applies a `decisions.json` file exported from the M8 HTML
 * report (PLAN.md §21). Decisions are checked for structural validity
 * against the audit report snapshot the reviewer actually saw
 * (`<workspace>/audit.json`, written by `report`), then against the
 * workspace's current live groups for staleness — has group membership
 * changed since that snapshot was taken, e.g. because `audit` was re-run
 * in between. Structural problems always block the whole import (nothing
 * is applied). Stale decisions also block the whole import unless
 * `--force-stale-decisions` is given, in which case only the stale
 * decisions are re-validated against live data — one that's still
 * nonsensical against the group as it exists *now* (e.g. its selected
 * image was itself removed from the group) is skipped rather than forced.
 *
 * Applying happens in a single database transaction, matching this
 * workspace's "use transactions for state-changing operations" contract
 * (PLAN.md §6).
 */
export async function importReviewDecisions(
  options: ImportReviewDecisionsOptions,
): Promise<ImportReviewDecisionsResult> {
  const { workspace, decisionsPath, forceStaleDecisions, logger } = options;

  const decisionsJson = await readJsonFile(decisionsPath, "decisions file");
  const decisionsParse = reviewDecisionsSchema.safeParse(decisionsJson);
  if (!decisionsParse.success) {
    throw new CliError(
      `Decisions file "${decisionsPath}" does not match the supported schema:\n${formatZodError(decisionsParse.error)}`,
      ExitCode.invalidConfiguration,
      'It must be a JSON array of decisions, as exported by the HTML report\'s "Export decisions" button.',
    );
  }
  const decisions = decisionsParse.data;

  const auditJsonPath = join(workspace, "audit.json");
  const auditJson = await readJsonFile(auditJsonPath, "audit report");
  const reportParse = jsonReportSchema.safeParse(auditJson);
  if (!reportParse.success) {
    throw new CliError(
      `Workspace audit report "${auditJsonPath}" does not match the supported schema:\n${formatZodError(reportParse.error)}`,
      ExitCode.commandFailed,
      "Re-run `image-origin report` to regenerate it, then re-export decisions from the new HTML report.",
    );
  }
  // `jsonReportSchema`'s group items validate structurally (e.g. `relationship`
  // as `z.string()`) but are narrower in practice, since `audit.json` was
  // written by `buildJsonReport()` from real `ImageGroup` values in the
  // first place (see json-report.ts) — safe to treat as `ImageGroup[]` here.
  const snapshotGroups = new Map(
    (reportParse.data.groups as ImageGroup[]).map((group) => [group.id, group]),
  );

  const db = await openDatabase(workspace);
  try {
    const liveGroups = new Map(listAllGroups(db).map((group) => [group.id, group]));

    const firstPass = validateDecisions(decisions, snapshotGroups, liveGroups);

    if (firstPass.invalid.length > 0) {
      throw new CliError(
        `Decisions file has ${firstPass.invalid.length} invalid decision(s):\n${formatIssues(firstPass.invalid)}`,
        ExitCode.invalidConfiguration,
        "Fix or remove the invalid decisions, then re-import. No decisions were applied.",
      );
    }

    let toApply = firstPass.valid;
    let skippedStale: DecisionIssue[] = [];

    if (firstPass.stale.length > 0) {
      if (!forceStaleDecisions) {
        throw new CliError(
          `${firstPass.stale.length} decision(s) are stale — group membership has changed since the audit report was generated:\n${formatIssues(firstPass.stale)}`,
          ExitCode.unsafeOperationRefused,
          "Re-run `image-origin report` and re-review the affected groups, or re-run this command with --force-stale-decisions to apply them anyway against the current group membership. No decisions were applied.",
        );
      }

      logger.warn(
        `Applying ${firstPass.stale.length} stale decision(s) because --force-stale-decisions was given. Group membership for these groups has changed since the audit report was generated — verify the applied result carefully.`,
      );

      const staleGroupIds = new Set(firstPass.stale.map((issue) => issue.groupId));
      const staleDecisions = decisions.filter((decision) => staleGroupIds.has(decision.groupId));
      const revalidated = validateDecisions(staleDecisions, liveGroups, liveGroups);
      toApply = [...toApply, ...revalidated.valid];
      skippedStale = revalidated.invalid;
      for (const issue of skippedStale) {
        logger.warn(`Skipping decision for group "${issue.groupId}": ${issue.reason}`);
      }
    }

    db.transaction(() => {
      for (const decision of toApply) {
        const liveGroup = liveGroups.get(decision.groupId);
        if (!liveGroup) {
          continue;
        }
        const updated = applyDecisionToGroup(liveGroup, decision);
        imageGroupSchema.parse(updated);
        updateGroup(db, updated);
      }
    })();

    const existingDecisions = await readDecisionsFile(workspace);
    await writeDecisionsFile(workspace, mergeDecisions(existingDecisions, toApply));

    return { totalDecisions: decisions.length, applied: toApply, skippedStale };
  } finally {
    db.close();
  }
}
