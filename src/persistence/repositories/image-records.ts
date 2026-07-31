import type { ImageRecord } from "../../domain/image-record.js";
import type { ImageOriginDatabase } from "../database.js";

interface ImageRow {
  real_path: string;
  path: string;
  relative_path: string;
  size_bytes: number;
  modified_at: string;
  sha256: string;
  record_json: string;
  scanned_at: string;
}

function rowToRecord(row: ImageRow): ImageRecord {
  return JSON.parse(row.record_json) as ImageRecord;
}

const upsertStatementCache = new WeakMap<
  ImageOriginDatabase,
  ReturnType<ImageOriginDatabase["prepare"]>
>();

function upsertStatement(db: ImageOriginDatabase) {
  const cached = upsertStatementCache.get(db);
  if (cached) return cached;
  const statement = db.prepare(`
    INSERT INTO images (real_path, path, relative_path, size_bytes, modified_at, sha256, record_json, scanned_at)
    VALUES (@realPath, @path, @relativePath, @sizeBytes, @modifiedAt, @sha256, @recordJson, @scannedAt)
    ON CONFLICT(real_path) DO UPDATE SET
      path = excluded.path,
      relative_path = excluded.relative_path,
      size_bytes = excluded.size_bytes,
      modified_at = excluded.modified_at,
      sha256 = excluded.sha256,
      record_json = excluded.record_json,
      scanned_at = excluded.scanned_at
  `);
  upsertStatementCache.set(db, statement);
  return statement;
}

export function upsertImageRecord(db: ImageOriginDatabase, record: ImageRecord): void {
  upsertStatement(db).run({
    realPath: record.realPath,
    path: record.path,
    relativePath: record.relativePath,
    sizeBytes: record.file.sizeBytes,
    modifiedAt: record.file.modifiedAt,
    sha256: record.file.sha256,
    recordJson: JSON.stringify(record),
    scannedAt: new Date().toISOString(),
  });
}

/**
 * Returns the cached record for `realPath` only if it is still valid for
 * `sizeBytes`/`modifiedAt` (PLAN.md §6: "identify unchanged files using
 * path, size, modification time, and hash"). A `--force` re-scan bypasses
 * this by never calling it.
 */
export function findCachedRecord(
  db: ImageOriginDatabase,
  realPath: string,
  sizeBytes: number,
  modifiedAt: string,
): ImageRecord | undefined {
  const row = db
    .prepare<{ realPath: string; sizeBytes: number; modifiedAt: string }, ImageRow>(
      "SELECT * FROM images WHERE real_path = @realPath AND size_bytes = @sizeBytes AND modified_at = @modifiedAt",
    )
    .get({ realPath, sizeBytes, modifiedAt });

  return row ? rowToRecord(row) : undefined;
}

export function getImageRecord(db: ImageOriginDatabase, realPath: string): ImageRecord | undefined {
  const row = db
    .prepare<{ realPath: string }, ImageRow>("SELECT * FROM images WHERE real_path = @realPath")
    .get({
      realPath,
    });
  return row ? rowToRecord(row) : undefined;
}

export function listImageRecords(db: ImageOriginDatabase): ImageRecord[] {
  const rows = db.prepare<[], ImageRow>("SELECT * FROM images ORDER BY relative_path ASC").all();
  return rows.map(rowToRecord);
}

export function countImageRecords(db: ImageOriginDatabase): number {
  const row = db.prepare<[], { count: number }>("SELECT COUNT(*) as count FROM images").get();
  return row?.count ?? 0;
}
