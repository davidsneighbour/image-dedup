import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const DEFAULT_MAX_DIMENSION = 320;

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generates (or reuses) a display-oriented thumbnail for one image, cached
 * by content hash under `cacheDir` — so re-running `report` against an
 * unchanged workspace regenerates nothing (PLAN.md §6: "do not rescan
 * unchanged files" applies equally to report assets). Auto-orients via
 * EXIF (`.rotate()`) since this is purely for human display, unlike the
 * pixel-space work in `detail-crops.ts`.
 */
export async function ensureThumbnail(
  record: { realPath: string; file: { sha256: string } },
  cacheDir: string,
  maxDimension: number = DEFAULT_MAX_DIMENSION,
): Promise<string> {
  await mkdir(cacheDir, { recursive: true });
  const outputPath = join(cacheDir, `${record.file.sha256}.webp`);
  if (await fileExists(outputPath)) {
    return outputPath;
  }

  await sharp(record.realPath)
    .rotate()
    .resize({ width: maxDimension, height: maxDimension, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(outputPath);

  return outputPath;
}
