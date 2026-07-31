import type { ImageRecord } from "../domain/image-record.js";
import { BKTree } from "./bk-tree.js";
import { hammingDistanceHex } from "./perceptual-hash.js";

type HashedRecord = ImageRecord & { hashes: { difference: string; sha256: string } };

function hasDifferenceHash(record: ImageRecord): record is HashedRecord {
  return typeof record.hashes.difference === "string";
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a} ${b}` : `${b} ${a}`;
}

/**
 * Cropping removes real content — a much bigger perceptual change than a
 * resize or recompression — so M4's standard `perceptualDistanceThreshold`
 * (tuned for "essentially the same framing") is nowhere near permissive
 * enough to surface most crop candidates. This is deliberately a *wide,
 * cheap* net: `detectCrop`'s sliding-window correlation is what actually
 * decides yes/no, with a high confidence bar. Being permissive here only
 * means "worth checking," not "probably a crop."
 */
const CROP_CANDIDATE_DISTANCE_THRESHOLD = 28;

export interface CropCandidatePair {
  a: string;
  b: string;
}

/**
 * A dHash-only candidate search specifically to feed crop detection
 * (PLAN.md §12). Unlike `generateCandidatePairs` (M4), this does **not**
 * bucket by aspect ratio — a crop routinely changes the aspect ratio, so
 * bucketing on it the way M4 does for resize/format candidates would
 * defeat the purpose here. Instead it runs a single BK-tree over every
 * hashed record: still no all-pairs comparison, just a wider net than
 * M4's, and correspondingly more expensive (O(n log n)-ish over the whole
 * set rather than partitioned buckets) — acceptable since it only needs
 * to run once per audit, not per candidate pair.
 */
export function generateCropCandidatePairs(records: readonly ImageRecord[]): CropCandidatePair[] {
  const hashed = records.filter(hasDifferenceHash);
  const tree = new BKTree<HashedRecord>((a, b) =>
    hammingDistanceHex(a.hashes.difference, b.hashes.difference),
  );
  for (const record of hashed) {
    tree.insert(record);
  }

  const seen = new Set<string>();
  const pairs: CropCandidatePair[] = [];

  for (const record of hashed) {
    const matches = tree.search(record, CROP_CANDIDATE_DISTANCE_THRESHOLD);
    for (const match of matches) {
      const candidate = match.item;
      if (candidate.id === record.id || candidate.file.sha256 === record.file.sha256) {
        continue;
      }
      const key = pairKey(record.id, candidate.id);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const [a, b] =
        record.id < candidate.id ? [record.id, candidate.id] : [candidate.id, record.id];
      pairs.push({ a, b });
    }
  }

  pairs.sort((x, y) => x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
  return pairs;
}
