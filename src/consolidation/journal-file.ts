import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ConsolidationOperation } from "../domain/operation.js";

/**
 * Human-readable copy of a run's operation journal (PLAN.md §23.3),
 * written to `<workspace>/journal/<runId>.json`. Not listed in PLAN.md
 * §6's workspace diagram, which predates this milestone; added alongside
 * `report/` and `cache/` as another workspace subdirectory, following the
 * same "add what's needed, document it here" precedent M8 set for
 * `report/assets/`. The `operations` DB table (not this file) is the
 * authoritative record rollback actually reads from — this file exists
 * purely so a human (or another tool) can inspect what a run did without
 * opening the SQLite database.
 */
export async function writeJournalFile(
  workspace: string,
  runId: string,
  operations: readonly ConsolidationOperation[],
): Promise<string> {
  const journalDir = join(workspace, "journal");
  await mkdir(journalDir, { recursive: true });
  const journalPath = join(journalDir, `${runId}.json`);
  await writeFile(journalPath, `${JSON.stringify(operations, null, 2)}\n`, "utf8");
  return journalPath;
}
