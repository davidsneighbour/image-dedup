import type { ImageOriginDatabase } from "./database.js";

/** Runs `fn` inside a SQLite transaction, committing on return and rolling back on throw. */
export function withTransaction<T>(db: ImageOriginDatabase, fn: () => T): T {
  return db.transaction(fn)();
}
