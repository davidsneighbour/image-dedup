import type { ImageGroup, ImageGroupKind } from "../../domain/image-group.js";
import type { ImageOriginDatabase } from "../database.js";

interface GroupRow {
  id: string;
  kind: string;
  group_json: string;
  updated_at: string;
}

function rowToGroup(row: GroupRow): ImageGroup {
  return JSON.parse(row.group_json) as ImageGroup;
}

/**
 * Groups are fully derived data: replaces every group of `kind` with the
 * freshly computed set in one transaction, rather than trying to
 * incrementally patch previous results. Recomputing from scratch each run
 * is cheap (pure in-memory grouping over already-inventoried records) and
 * avoids subtle staleness bugs (e.g. a group that should have gained or
 * lost a member).
 */
export function replaceGroupsOfKind(
  db: ImageOriginDatabase,
  kind: ImageGroupKind,
  groups: readonly ImageGroup[],
): void {
  const deleteStatement = db.prepare("DELETE FROM groups WHERE kind = @kind");
  const insertStatement = db.prepare(
    "INSERT INTO groups (id, kind, group_json, updated_at) VALUES (@id, @kind, @groupJson, @updatedAt)",
  );

  db.transaction(() => {
    deleteStatement.run({ kind });
    const updatedAt = new Date().toISOString();
    for (const group of groups) {
      insertStatement.run({
        id: group.id,
        kind: group.kind,
        groupJson: JSON.stringify(group),
        updatedAt,
      });
    }
  })();
}

export function listGroupsOfKind(db: ImageOriginDatabase, kind: ImageGroupKind): ImageGroup[] {
  const rows = db
    .prepare<{ kind: string }, GroupRow>("SELECT * FROM groups WHERE kind = @kind ORDER BY id ASC")
    .all({ kind });
  return rows.map(rowToGroup);
}

/** Every persisted group regardless of kind — e.g. for review import, which validates decisions against groups without caring which detector produced them. */
export function listAllGroups(db: ImageOriginDatabase): ImageGroup[] {
  const rows = db.prepare<[], GroupRow>("SELECT * FROM groups ORDER BY id ASC").all();
  return rows.map(rowToGroup);
}

/**
 * Patches a single already-persisted group in place (by `id`, the table's
 * primary key), unlike `replaceGroupsOfKind`'s wholesale recompute — used
 * by review import, which only ever touches the specific groups a human
 * reviewer made a decision about.
 */
export function updateGroup(db: ImageOriginDatabase, group: ImageGroup): void {
  db.prepare(
    "UPDATE groups SET kind = @kind, group_json = @groupJson, updated_at = @updatedAt WHERE id = @id",
  ).run({
    id: group.id,
    kind: group.kind,
    groupJson: JSON.stringify(group),
    updatedAt: new Date().toISOString(),
  });
}
