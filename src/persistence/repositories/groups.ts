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
