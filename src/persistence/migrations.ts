import type Database from "better-sqlite3";

export interface Migration {
  version: number;
  sql: string;
}

/**
 * Linear migrations applied in order, tracked via SQLite's built-in
 * `user_version` pragma. See PLAN.md §6 ("store schema version; support
 * database migrations").
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE images (
        real_path     TEXT PRIMARY KEY,
        path          TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        size_bytes    INTEGER NOT NULL,
        modified_at   TEXT NOT NULL,
        sha256        TEXT NOT NULL,
        record_json   TEXT NOT NULL,
        scanned_at    TEXT NOT NULL
      );
      CREATE INDEX idx_images_sha256 ON images (sha256);

      CREATE TABLE scan_errors (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        phase       TEXT NOT NULL,
        file_path   TEXT,
        operation   TEXT NOT NULL,
        error       TEXT NOT NULL,
        continued   INTEGER NOT NULL,
        remediation TEXT,
        created_at  TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE groups (
        id          TEXT PRIMARY KEY,
        kind        TEXT NOT NULL,
        group_json  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX idx_groups_kind ON groups (kind);
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE candidate_pairs (
        a                  TEXT NOT NULL,
        b                  TEXT NOT NULL,
        d_hash_distance    INTEGER NOT NULL,
        p_hash_distance    INTEGER NOT NULL,
        aspect_ratio_delta REAL NOT NULL,
        updated_at         TEXT NOT NULL,
        PRIMARY KEY (a, b)
      );
    `,
  },
  {
    version: 4,
    sql: `
      CREATE TABLE comparisons (
        a             TEXT NOT NULL,
        b             TEXT NOT NULL,
        relationship  TEXT NOT NULL,
        confidence    REAL NOT NULL,
        ssim_score    REAL NOT NULL,
        transform     TEXT NOT NULL,
        reasons_json  TEXT NOT NULL,
        warnings_json TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        PRIMARY KEY (a, b)
      );
    `,
  },
  {
    version: 5,
    sql: `
      ALTER TABLE comparisons ADD COLUMN details_json TEXT;
    `,
  },
  {
    version: 6,
    sql: `
      CREATE TABLE operations (
        operation_id      TEXT PRIMARY KEY,
        run_id            TEXT NOT NULL,
        type              TEXT NOT NULL,
        source            TEXT NOT NULL,
        destination       TEXT NOT NULL,
        source_hash       TEXT NOT NULL,
        destination_hash  TEXT,
        status            TEXT NOT NULL,
        created_at        TEXT NOT NULL,
        rolled_back_at    TEXT
      );
      CREATE INDEX idx_operations_run_id ON operations (run_id);
      CREATE INDEX idx_operations_destination ON operations (destination);
    `,
  },
];

export function runMigrations(db: Database.Database): void {
  const currentVersion = db.pragma("user_version", { simple: true }) as number;

  const pending = MIGRATIONS.filter((migration) => migration.version > currentVersion).sort(
    (a, b) => a.version - b.version,
  );

  for (const migration of pending) {
    db.transaction(() => {
      db.exec(migration.sql);
      db.pragma(`user_version = ${migration.version}`);
    })();
  }
}
