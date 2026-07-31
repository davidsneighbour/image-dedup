import { stat } from "node:fs/promises";
import { relative } from "node:path";
import pLimit from "p-limit";
import type { Logger } from "../cli/output.js";
import type { ImageOriginConfig } from "../config/schema.js";
import { inspectImage } from "../inventory/inspect-image.js";
import { generateCandidatePairs } from "../matching/candidate-index.js";
import { computeExactDuplicateGroups } from "../matching/exact-duplicates.js";
import { computeMissingHashes } from "../matching/hash-images.js";
import { openDatabase } from "../persistence/database.js";
import { replaceCandidatePairs } from "../persistence/repositories/candidate-pairs.js";
import { recordScanError } from "../persistence/repositories/errors.js";
import { replaceGroupsOfKind } from "../persistence/repositories/groups.js";
import {
  findCachedRecord,
  listImageRecords,
  upsertImageRecord,
} from "../persistence/repositories/image-records.js";
import { type DiscoveryEntry, discoverFiles } from "./discover-files.js";

export interface RunAuditOptions {
  config: ImageOriginConfig;
  logger: Logger;
  force: boolean;
}

export interface RunAuditResult {
  discovered: number;
  unsupported: number;
  inaccessible: number;
  duplicatePaths: number;
  symlinkSkipped: number;
  inspected: number;
  reusedFromCache: number;
  errors: number;
  exactDuplicateGroups: number;
  wastedBytes: number;
  hashesComputed: number;
  hashesReused: number;
  perceptualCandidatePairs: number;
}

/**
 * Runs discovery (PLAN.md §7) followed by inventory (PLAN.md §8) and
 * persists results to the workspace database. Unchanged files (same real
 * path, size, and mtime) are skipped and their cached record reused,
 * unless `force` is set. Individual file failures are recorded and do not
 * abort the run (PLAN.md §29.3).
 */
export async function runAudit(options: RunAuditOptions): Promise<RunAuditResult> {
  const { config, logger, force } = options;

  const entries = await discoverFiles({
    inputs: config.inputs,
    include: config.include,
    exclude: config.exclude,
    followSymlinks: config.discovery.followSymlinks,
    workspace: config.workspace,
  });

  const counts = {
    discovered: 0,
    unsupported: 0,
    inaccessible: 0,
    duplicatePaths: 0,
    symlinkSkipped: 0,
  };
  const discoveredEntries: DiscoveryEntry[] = [];

  for (const entry of entries) {
    switch (entry.status) {
      case "discovered":
        counts.discovered++;
        discoveredEntries.push(entry);
        break;
      case "unsupported":
        counts.unsupported++;
        break;
      case "inaccessible":
        counts.inaccessible++;
        break;
      case "duplicate-path":
        counts.duplicatePaths++;
        break;
      case "symlink-skipped":
        counts.symlinkSkipped++;
        break;
    }
  }

  logger.info("Discovery");
  logger.info(`  Found ${counts.discovered} candidate files`);
  if (counts.unsupported > 0) logger.info(`  Ignored ${counts.unsupported} unsupported files`);
  if (counts.duplicatePaths > 0) logger.info(`  Found ${counts.duplicatePaths} duplicate paths`);
  if (counts.inaccessible > 0) logger.info(`  Found ${counts.inaccessible} unreadable files`);
  if (counts.symlinkSkipped > 0) logger.info(`  Skipped ${counts.symlinkSkipped} symlinks`);

  const db = await openDatabase(config.workspace);
  let inspected = 0;
  let reusedFromCache = 0;
  let errorCount = 0;
  let exactDuplicateGroups = 0;
  let wastedBytes = 0;
  let hashesComputed = 0;
  let hashesReused = 0;
  let perceptualCandidatePairs = 0;

  try {
    const limit = pLimit(config.concurrency.metadata);

    await Promise.all(
      discoveredEntries.map((entry) =>
        limit(async () => {
          const realPath = entry.realPath;
          if (!realPath) {
            return;
          }
          try {
            const stats = await stat(realPath);

            if (!force) {
              const cached = findCachedRecord(db, realPath, stats.size, stats.mtime.toISOString());
              if (cached) {
                reusedFromCache++;
                return;
              }
            }

            const record = await inspectImage({
              realPath,
              path: entry.path,
              relativePath: relative(entry.inputDirectory, realPath),
              maxInputPixels: config.limits.maxInputPixels,
            });
            upsertImageRecord(db, record);
            inspected++;
          } catch (error) {
            errorCount++;
            const report = {
              phase: "inventory",
              filePath: entry.path,
              operation: "inspect image",
              error: error instanceof Error ? error.message : String(error),
              continued: true,
            };
            recordScanError(db, report);
            logger.error(report);
          }
        }),
      ),
    );

    // Recomputed from every currently-inventoried record (not just this
    // run's newly-scanned ones), so a duplicate spanning an earlier and a
    // later scan is still detected. See PLAN.md §9.
    if (config.matching.exactHash) {
      const allRecords = listImageRecords(db);
      const exactDuplicates = computeExactDuplicateGroups(allRecords, config.pathPreferences);
      replaceGroupsOfKind(db, "exact-duplicate", exactDuplicates.groups);
      exactDuplicateGroups = exactDuplicates.groups.length;
      wastedBytes = exactDuplicates.wastedBytes;
    }

    if (config.matching.perceptualHash) {
      // Perceptual hashing operates over every currently-inventoried
      // record too, for the same resumability reason as exact-duplicate
      // matching above. Records that already carry both hashes (from a
      // previous run) are skipped entirely (PLAN.md §10.2).
      const recordsForHashing = listImageRecords(db);
      const hashResult = await computeMissingHashes(recordsForHashing, {
        concurrency: config.concurrency.decoding,
        onHashed: (record) => upsertImageRecord(db, record),
        onError: (record, error) => {
          errorCount++;
          const report = {
            phase: "matching",
            filePath: record.path,
            operation: "compute perceptual hash",
            error: error instanceof Error ? error.message : String(error),
            continued: true,
          };
          recordScanError(db, report);
          logger.error(report);
        },
      });
      hashesComputed = hashResult.computed;
      hashesReused = hashResult.reused;

      const hashedRecords = listImageRecords(db);
      const candidatePairs = generateCandidatePairs(hashedRecords, config.matching);
      replaceCandidatePairs(db, candidatePairs);
      perceptualCandidatePairs = candidatePairs.length;
    }
  } finally {
    db.close();
  }

  logger.info("Inventory");
  logger.info(`  Inspected ${inspected} images`);
  logger.info(`  Reused ${reusedFromCache} cached records`);
  if (errorCount > 0) logger.info(`  Recorded ${errorCount} errors`);

  logger.info("Matching");
  if (config.matching.exactHash) {
    logger.info(`  Found ${exactDuplicateGroups} exact duplicate groups`);
    if (wastedBytes > 0) {
      logger.info(
        `  ${(wastedBytes / (1024 * 1024)).toFixed(2)} MB recoverable from exact duplicates`,
      );
    }
  }
  if (config.matching.perceptualHash) {
    logger.info(`  Computed ${hashesComputed} perceptual hashes (${hashesReused} reused)`);
    logger.info(
      `  Found ${perceptualCandidatePairs} perceptual candidate pairs (pending confirmation)`,
    );
  }

  return {
    ...counts,
    inspected,
    reusedFromCache,
    errors: errorCount,
    exactDuplicateGroups,
    wastedBytes,
    hashesComputed,
    hashesReused,
    perceptualCandidatePairs,
  };
}
