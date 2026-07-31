import type { PerceptualCandidatePair } from "../../domain/candidate-pair.js";
import type { ImageOriginDatabase } from "../database.js";

interface CandidatePairRow {
  a: string;
  b: string;
  d_hash_distance: number;
  p_hash_distance: number;
  aspect_ratio_delta: number;
  updated_at: string;
}

function rowToPair(row: CandidatePairRow): PerceptualCandidatePair {
  return {
    a: row.a,
    b: row.b,
    dHashDistance: row.d_hash_distance,
    pHashDistance: row.p_hash_distance,
    aspectRatioDelta: row.aspect_ratio_delta,
  };
}

/** Candidate pairs are fully derived data — replaced wholesale each run, same rationale as `replaceGroupsOfKind`. */
export function replaceCandidatePairs(
  db: ImageOriginDatabase,
  pairs: readonly PerceptualCandidatePair[],
): void {
  const insertStatement = db.prepare(
    `INSERT INTO candidate_pairs (a, b, d_hash_distance, p_hash_distance, aspect_ratio_delta, updated_at)
     VALUES (@a, @b, @dHashDistance, @pHashDistance, @aspectRatioDelta, @updatedAt)`,
  );

  db.transaction(() => {
    db.exec("DELETE FROM candidate_pairs");
    const updatedAt = new Date().toISOString();
    for (const pair of pairs) {
      insertStatement.run({ ...pair, updatedAt });
    }
  })();
}

export function listCandidatePairs(db: ImageOriginDatabase): PerceptualCandidatePair[] {
  const rows = db
    .prepare<[], CandidatePairRow>("SELECT * FROM candidate_pairs ORDER BY a ASC, b ASC")
    .all();
  return rows.map(rowToPair);
}
