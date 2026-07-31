import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import type { ImageRecord } from "../domain/image-record.js";
import { sha256File } from "./exact-hash.js";
import { inspectMetadata } from "./metadata.js";

export interface InspectImageOptions {
  /** Absolute, symlink-resolved path to read. */
  realPath: string;
  /** Path to record on the resulting `ImageRecord` (as originally discovered). */
  path: string;
  relativePath: string;
  maxInputPixels: number;
}

/** Deterministic id derived from the resolved path, stable across re-scans. */
function idForPath(realPath: string): string {
  return `img_${createHash("sha1").update(realPath).digest("hex").slice(0, 20)}`;
}

/**
 * Produces a complete `ImageRecord` for one file: filesystem stats, SHA-256,
 * and sharp-derived metadata. Throws on any failure (missing file, decode
 * failure); callers turn that into a recorded, non-fatal error rather than
 * aborting the scan (PLAN.md §7.1, §29.3).
 */
export async function inspectImage(options: InspectImageOptions): Promise<ImageRecord> {
  const stats = await stat(options.realPath);
  const [sha256, metadata] = await Promise.all([
    sha256File(options.realPath),
    inspectMetadata(options.realPath, options.maxInputPixels),
  ]);

  const warnings: string[] = [];

  return {
    id: idForPath(options.realPath),
    path: options.path,
    realPath: options.realPath,
    relativePath: options.relativePath,
    file: {
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      createdAt: stats.birthtime.toISOString(),
      sha256,
      inode: stats.ino,
      device: stats.dev,
    },
    image: metadata.image,
    metadata: metadata.metadata,
    hashes: {
      sha256,
    },
    quality: {},
    warnings,
  };
}
