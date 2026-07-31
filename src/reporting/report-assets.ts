import { copyFile, mkdir } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import pLimit from "p-limit";
import type { ImageGroup } from "../domain/image-group.js";
import type { ImageRecord } from "../domain/image-record.js";
import { ensureDetailCrops } from "./detail-crops.js";
import type { JsonReportImageAssets } from "./json-report.js";
import { ensureThumbnail } from "./thumbnails.js";

export interface BuildReportAssetsOptions {
  /** Audit workspace root — thumbnails/crops are cached here, keyed by content hash, so re-running `report` regenerates nothing. */
  workspace: string;
  /** `<workspace>/report` — the self-contained output directory the HTML report lives in. */
  reportDir: string;
  concurrency: number;
  onError?: (record: ImageRecord, error: unknown) => void;
}

/**
 * Generates thumbnails and detail crops only for images that are actually
 * members of at least one group — ungrouped images have nothing to
 * compare against in the review report, so there's no point spending
 * decode time on them. Assets are cached under `<workspace>/cache/` (for
 * resumability, PLAN.md §6) and then copied into `<reportDir>/assets/`
 * so the report directory is self-contained and portable on its own.
 *
 * Returns paths relative to `reportDir`, ready to use as `<img src>` in
 * the generated HTML.
 */
export async function buildReportAssets(
  records: readonly ImageRecord[],
  groups: readonly ImageGroup[],
  options: BuildReportAssetsOptions,
): Promise<Map<string, JsonReportImageAssets>> {
  const memberIds = new Set<string>();
  for (const group of groups) {
    for (const member of group.members) {
      memberIds.add(member);
    }
  }
  const relevantRecords = records.filter((record) => memberIds.has(record.id));

  const thumbnailCacheDir = join(options.workspace, "cache", "thumbnails");
  const detailCropCacheDir = join(options.workspace, "cache", "detail-crops");
  const thumbnailAssetsDir = join(options.reportDir, "assets", "thumbnails");
  const detailCropAssetsDir = join(options.reportDir, "assets", "detail-crops");
  await Promise.all([
    mkdir(thumbnailAssetsDir, { recursive: true }),
    mkdir(detailCropAssetsDir, { recursive: true }),
  ]);

  const limit = pLimit(options.concurrency);
  const result = new Map<string, JsonReportImageAssets>();

  await Promise.all(
    relevantRecords.map((record) =>
      limit(async () => {
        try {
          const [thumbnailCachePath, cropPaths] = await Promise.all([
            ensureThumbnail(record, thumbnailCacheDir),
            ensureDetailCrops(record, detailCropCacheDir),
          ]);

          const thumbnailAssetPath = join(thumbnailAssetsDir, basename(thumbnailCachePath));
          const centerAssetPath = join(detailCropAssetsDir, basename(cropPaths.center));
          const detailAssetPath = join(detailCropAssetsDir, basename(cropPaths.highestDetail));

          await Promise.all([
            copyFile(thumbnailCachePath, thumbnailAssetPath),
            copyFile(cropPaths.center, centerAssetPath),
            copyFile(cropPaths.highestDetail, detailAssetPath),
          ]);

          result.set(record.id, {
            thumbnail: relative(options.reportDir, thumbnailAssetPath),
            centerCrop: relative(options.reportDir, centerAssetPath),
            detailCrop: relative(options.reportDir, detailAssetPath),
          });
        } catch (error) {
          options.onError?.(record, error);
        }
      }),
    ),
  );

  return result;
}
