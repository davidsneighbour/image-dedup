import { stat } from "node:fs/promises";
import { relative } from "node:path";
import pLimit from "p-limit";
import type { Logger } from "../cli/output.js";
import type { ImageOriginConfig } from "../config/schema.js";
import { inspectImage } from "../inventory/inspect-image.js";
import { openDatabase } from "../persistence/database.js";
import { recordScanError } from "../persistence/repositories/errors.js";
import { findCachedRecord, upsertImageRecord } from "../persistence/repositories/image-records.js";
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
  } finally {
    db.close();
  }

  logger.info("Inventory");
  logger.info(`  Inspected ${inspected} images`);
  logger.info(`  Reused ${reusedFromCache} cached records`);
  if (errorCount > 0) logger.info(`  Recorded ${errorCount} errors`);

  return {
    ...counts,
    inspected,
    reusedFromCache,
    errors: errorCount,
  };
}
