import type { ConfirmedComparison } from "../../matching/confirm-candidates.js";
import type { ImageOriginDatabase } from "../database.js";

interface ComparisonRow {
  a: string;
  b: string;
  relationship: string;
  confidence: number;
  ssim_score: number;
  transform: string;
  reasons_json: string;
  warnings_json: string;
  details_json: string | null;
  updated_at: string;
}

function rowToComparison(row: ComparisonRow): ConfirmedComparison {
  return {
    a: row.a,
    b: row.b,
    relationship: row.relationship as ConfirmedComparison["relationship"],
    confidence: row.confidence,
    ssimScore: row.ssim_score,
    transformUsed: row.transform as ConfirmedComparison["transformUsed"],
    reasons: JSON.parse(row.reasons_json) as string[],
    warnings: JSON.parse(row.warnings_json) as string[],
    ...(row.details_json
      ? { details: JSON.parse(row.details_json) as Record<string, unknown> }
      : {}),
  };
}

/**
 * Every classified pair is persisted, confirmed or not — this is what
 * makes "uncertain pairs are labelled rather than forced" (M5's
 * acceptance criterion) inspectable rather than just an internal decision
 * that leaves no trace. Replaced wholesale each run, same pattern as
 * groups and candidate pairs.
 */
export function replaceComparisons(
  db: ImageOriginDatabase,
  comparisons: readonly ConfirmedComparison[],
): void {
  const insertStatement = db.prepare(
    `INSERT INTO comparisons (a, b, relationship, confidence, ssim_score, transform, reasons_json, warnings_json, details_json, updated_at)
     VALUES (@a, @b, @relationship, @confidence, @ssimScore, @transformUsed, @reasonsJson, @warningsJson, @detailsJson, @updatedAt)`,
  );

  db.transaction(() => {
    db.exec("DELETE FROM comparisons");
    const updatedAt = new Date().toISOString();
    for (const comparison of comparisons) {
      insertStatement.run({
        a: comparison.a,
        b: comparison.b,
        relationship: comparison.relationship,
        confidence: comparison.confidence,
        ssimScore: comparison.ssimScore,
        transformUsed: comparison.transformUsed,
        reasonsJson: JSON.stringify(comparison.reasons),
        warningsJson: JSON.stringify(comparison.warnings),
        detailsJson: comparison.details ? JSON.stringify(comparison.details) : null,
        updatedAt,
      });
    }
  })();
}

export function listComparisons(db: ImageOriginDatabase): ConfirmedComparison[] {
  const rows = db
    .prepare<[], ComparisonRow>("SELECT * FROM comparisons ORDER BY a ASC, b ASC")
    .all();
  return rows.map(rowToComparison);
}
