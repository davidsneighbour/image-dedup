import type { ErrorReport } from "../../cli/output.js";
import type { ImageOriginDatabase } from "../database.js";

interface ErrorRow {
  id: number;
  phase: string;
  file_path: string | null;
  operation: string;
  error: string;
  continued: number;
  remediation: string | null;
  created_at: string;
}

function rowToReport(row: ErrorRow): ErrorReport {
  return {
    phase: row.phase,
    ...(row.file_path ? { filePath: row.file_path } : {}),
    operation: row.operation,
    error: row.error,
    continued: row.continued === 1,
    ...(row.remediation ? { remediation: row.remediation } : {}),
  };
}

export function recordScanError(db: ImageOriginDatabase, report: ErrorReport): void {
  db.prepare(
    `INSERT INTO scan_errors (phase, file_path, operation, error, continued, remediation, created_at)
     VALUES (@phase, @filePath, @operation, @error, @continued, @remediation, @createdAt)`,
  ).run({
    phase: report.phase,
    filePath: report.filePath ?? null,
    operation: report.operation,
    error: report.error,
    continued: report.continued ? 1 : 0,
    remediation: report.remediation ?? null,
    createdAt: new Date().toISOString(),
  });
}

export function listScanErrors(db: ImageOriginDatabase): ErrorReport[] {
  const rows = db.prepare<[], ErrorRow>("SELECT * FROM scan_errors ORDER BY id ASC").all();
  return rows.map(rowToReport);
}
