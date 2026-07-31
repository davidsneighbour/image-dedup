import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import type { ConsolidationOperation } from "../domain/operation.js";
import { sha256File } from "../inventory/exact-hash.js";
import type { CanonicalPathPlanEntry } from "./plan-canonical-paths.js";

function operationId(runId: string, destination: string): string {
  return `op_${createHash("sha1").update(`${runId}:${destination}`).digest("hex").slice(0, 20)}`;
}

/** Opens the just-written file and calls `fsync` so the copy survives a crash before the next step trusts it (PLAN.md §23.1 step 3). */
async function fsyncFile(path: string): Promise<void> {
  const handle = await open(path, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export interface CopyEntryResult {
  operation: ConsolidationOperation;
  error?: string;
}

/**
 * Executes one planned copy and verifies it end to end (PLAN.md §23.1):
 * create the destination directory, copy the source, fsync, hash the
 * destination, and compare against the source hash. Never overwrites an
 * existing destination (`COPYFILE_EXCL`) — collision resolution already
 * happened during planning, so an existing file here means the filesystem
 * changed since the plan was built, which should fail loudly rather than
 * silently clobber something.
 *
 * The source is re-hashed immediately before copying (not trusted from
 * the audit snapshot) — the file on disk may have changed since `audit`
 * last ran, and copying a since-modified file under the id of what the
 * plan believes it is would silently corrupt provenance.
 */
export async function copyAndVerifyEntry(
  entry: CanonicalPathPlanEntry,
  runId: string,
): Promise<CopyEntryResult> {
  const id = operationId(runId, entry.canonicalPath);
  const timestamp = new Date().toISOString();

  const base: Pick<
    ConsolidationOperation,
    "operationId" | "runId" | "type" | "source" | "destination" | "sourceHash" | "timestamp"
  > = {
    operationId: id,
    runId,
    type: "copy",
    source: entry.sourcePath,
    destination: entry.canonicalPath,
    sourceHash: entry.sourceSha256,
    timestamp,
  };

  if (entry.status === "reuse-existing") {
    return {
      operation: { ...base, destinationHash: entry.sourceSha256, status: "skipped-identical" },
    };
  }

  let liveSourceHash: string;
  try {
    liveSourceHash = await sha256File(entry.sourcePath);
  } catch (error) {
    return {
      operation: { ...base, status: "failed" },
      error: `could not read source file: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (liveSourceHash !== entry.sourceSha256) {
    return {
      operation: { ...base, status: "failed" },
      error: `source file changed since the audit ran (expected sha256 ${entry.sourceSha256.slice(0, 12)}…, found ${liveSourceHash.slice(0, 12)}…) — re-run \`audit\` before consolidating`,
    };
  }

  try {
    await mkdir(dirname(entry.canonicalPath), { recursive: true });
    await copyFile(entry.sourcePath, entry.canonicalPath, constants.COPYFILE_EXCL);
    await fsyncFile(entry.canonicalPath);
  } catch (error) {
    return {
      operation: { ...base, status: "failed" },
      error: `copy failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const destinationHash = await sha256File(entry.canonicalPath);
  if (destinationHash !== entry.sourceSha256) {
    return {
      operation: { ...base, destinationHash, status: "failed" },
      error: `destination hash mismatch after copy (expected ${entry.sourceSha256.slice(0, 12)}…, got ${destinationHash.slice(0, 12)}…)`,
    };
  }

  return { operation: { ...base, destinationHash, status: "verified" } };
}
