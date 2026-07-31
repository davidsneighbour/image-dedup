import type { ConsolidationOperation } from "../../domain/operation.js";
import type { ImageOriginDatabase } from "../database.js";

interface OperationRow {
  operation_id: string;
  run_id: string;
  type: string;
  source: string;
  destination: string;
  source_hash: string;
  destination_hash: string | null;
  status: string;
  created_at: string;
  rolled_back_at: string | null;
}

function rowToOperation(row: OperationRow): ConsolidationOperation {
  return {
    operationId: row.operation_id,
    runId: row.run_id,
    type: "copy",
    source: row.source,
    destination: row.destination,
    sourceHash: row.source_hash,
    destinationHash: row.destination_hash ?? undefined,
    status: row.status as ConsolidationOperation["status"],
    timestamp: row.created_at,
    rolledBackAt: row.rolled_back_at ?? undefined,
  };
}

export function insertOperation(db: ImageOriginDatabase, operation: ConsolidationOperation): void {
  db.prepare(
    `INSERT INTO operations
       (operation_id, run_id, type, source, destination, source_hash, destination_hash, status, created_at, rolled_back_at)
     VALUES
       (@operationId, @runId, @type, @source, @destination, @sourceHash, @destinationHash, @status, @createdAt, @rolledBackAt)`,
  ).run({
    operationId: operation.operationId,
    runId: operation.runId,
    type: operation.type,
    source: operation.source,
    destination: operation.destination,
    sourceHash: operation.sourceHash,
    destinationHash: operation.destinationHash ?? null,
    status: operation.status,
    createdAt: operation.timestamp,
    rolledBackAt: operation.rolledBackAt ?? null,
  });
}

export function listOperationsForRun(
  db: ImageOriginDatabase,
  runId: string,
): ConsolidationOperation[] {
  const rows = db
    .prepare<{ runId: string }, OperationRow>(
      "SELECT * FROM operations WHERE run_id = @runId ORDER BY created_at ASC, operation_id ASC",
    )
    .all({ runId });
  return rows.map(rowToOperation);
}

/** Every operation ever recorded against `destination`, across all runs — used to detect whether a later run still depends on a file a rollback would otherwise remove. */
export function listOperationsForDestination(
  db: ImageOriginDatabase,
  destination: string,
): ConsolidationOperation[] {
  const rows = db
    .prepare<{ destination: string }, OperationRow>(
      "SELECT * FROM operations WHERE destination = @destination ORDER BY created_at ASC, operation_id ASC",
    )
    .all({ destination });
  return rows.map(rowToOperation);
}

/** The most recently started run id, or `undefined` if no consolidation has ever run in this workspace. */
export function findMostRecentRunId(db: ImageOriginDatabase): string | undefined {
  const row = db
    .prepare<[], { run_id: string }>(
      "SELECT run_id FROM operations ORDER BY created_at DESC, operation_id DESC LIMIT 1",
    )
    .get();
  return row?.run_id;
}

export function markOperationRolledBack(
  db: ImageOriginDatabase,
  operationId: string,
  rolledBackAt: string,
): void {
  db.prepare(
    "UPDATE operations SET status = 'rolled-back', rolled_back_at = @rolledBackAt WHERE operation_id = @operationId",
  ).run({ operationId, rolledBackAt });
}
