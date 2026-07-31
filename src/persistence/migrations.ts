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
