import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type ReviewDecision, reviewDecisionsSchema } from "../domain/review-decision.js";

const DECISIONS_FILENAME = "decisions.json";

function decisionsPath(workspace: string): string {
  return join(workspace, DECISIONS_FILENAME);
}

/**
 * Reads the workspace's own persisted record of previously applied review
 * decisions (PLAN.md §6's `decisions.json`) — distinct from the file a
 * reviewer passes via `--decisions`, which lives wherever they downloaded
 * it from the HTML report. Returns an empty array if the workspace has
 * never had decisions applied, predates this file, or the file no longer
 * validates — treated as absent rather than a hard error, matching
 * `readResolvedConfig`'s precedent (`config/resolved-config-file.ts`).
 */
export async function readDecisionsFile(workspace: string): Promise<ReviewDecision[]> {
  let raw: string;
  try {
    raw = await readFile(decisionsPath(workspace), "utf8");
  } catch {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const result = reviewDecisionsSchema.safeParse(parsed);
  return result.success ? result.data : [];
}

export async function writeDecisionsFile(
  workspace: string,
  decisions: readonly ReviewDecision[],
): Promise<void> {
  await mkdir(workspace, { recursive: true });
  await writeFile(decisionsPath(workspace), `${JSON.stringify(decisions, null, 2)}\n`, "utf8");
}

/**
 * Merges newly applied decisions into the workspace's persisted set: a
 * decision for a group that already has a stored decision replaces it in
 * place (the reviewer changed their mind and re-imported), keyed by
 * `groupId`; genuinely new groups are appended. Pure — order of untouched
 * entries is preserved so the file doesn't churn on every import.
 */
export function mergeDecisions(
  existing: readonly ReviewDecision[],
  incoming: readonly ReviewDecision[],
): ReviewDecision[] {
  const incomingById = new Map(incoming.map((decision) => [decision.groupId, decision]));
  const merged = existing.map((decision) => incomingById.get(decision.groupId) ?? decision);

  const existingIds = new Set(existing.map((decision) => decision.groupId));
  for (const decision of incoming) {
    if (!existingIds.has(decision.groupId)) {
      merged.push(decision);
    }
  }

  return merged;
}
