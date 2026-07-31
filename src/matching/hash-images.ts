import pLimit from "p-limit";
import type { ImageRecord } from "../domain/image-record.js";
import { computeDifferenceHash, computePerceptualHash } from "./perceptual-hash.js";

export interface HashImagesOptions {
  concurrency: number;
  /** Called for every record whose hashes were (re)computed, so the caller can persist it. */
  onHashed: (record: ImageRecord) => void;
  /** Called when a hash computation fails; the record is left without perceptual hashes. */
  onError: (record: ImageRecord, error: unknown) => void;
}

export interface HashImagesResult {
  computed: number;
  reused: number;
}

/**
 * Computes dHash/pHash for every record that doesn't already have both
 * (perceptual hashing is deterministic over file content, so a record
 * that already carries hashes from a previous run never needs recomputing
 * — same cache philosophy as inventory's path+size+mtime check).
 *
 * Records are deduplicated by SHA-256 first: byte-identical files (already
 * grouped by M3's exact-duplicate detection) always hash identically, so
 * only one representative per content hash is actually decoded — the rest
 * just copy its result. This matters at scale, since decoding + DCT is the
 * most expensive step in this phase.
 */
export async function computeMissingHashes(
  records: readonly ImageRecord[],
  options: HashImagesOptions,
): Promise<HashImagesResult> {
  const alreadyHashed = records.filter(
    (record) => record.hashes.difference && record.hashes.perceptual,
  );
  const needsHashing = records.filter(
    (record) => !(record.hashes.difference && record.hashes.perceptual),
  );

  const bySha256 = new Map<string, ImageRecord[]>();
  for (const record of needsHashing) {
    const bucket = bySha256.get(record.file.sha256);
    if (bucket) {
      bucket.push(record);
    } else {
      bySha256.set(record.file.sha256, [record]);
    }
  }

  const limit = pLimit(options.concurrency);
  let computed = 0;

  await Promise.all(
    [...bySha256.values()].map((group) =>
      limit(async () => {
        const [representative, ...rest] = group;
        if (!representative) {
          return;
        }
        try {
          const [difference, perceptual] = await Promise.all([
            computeDifferenceHash(representative.realPath),
            computePerceptualHash(representative.realPath),
          ]);
          for (const record of group) {
            record.hashes.difference = difference;
            record.hashes.perceptual = perceptual;
            options.onHashed(record);
            computed++;
          }
        } catch (error) {
          for (const record of [representative, ...rest]) {
            options.onError(record, error);
          }
        }
      }),
    ),
  );

  return { computed, reused: alreadyHashed.length };
}
