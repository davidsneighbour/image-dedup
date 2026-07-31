import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations.js";

export type ImageOriginDatabase = Database.Database;

/**
 * Opens (creating if necessary) the workspace's SQLite database and brings
 * it up to the latest schema version. Never touches anything outside the
 * workspace directory. See PLAN.md §6.
 */
export async function openDatabase(workspace: string): Promise<ImageOriginDatabase> {
  await mkdir(workspace, { recursive: true });

  const db = new Database(join(workspace, "database.sqlite"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");

  runMigrations(db);

  return db;
}
