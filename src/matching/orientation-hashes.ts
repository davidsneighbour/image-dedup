import pLimit from "p-limit";
import type { ImageRecord } from "../domain/image-record.js";
import { ORIENTATION_TRANSFORMS, type OrientationTransform } from "./orientation-transform.js";
import { computeDifferenceHash, computePerceptualHash } from "./perceptual-hash.js";

export interface OrientationHashVariant {
  transform: OrientationTransform;
  dHash: string;
  pHash: string;
}

/**
 * dHash/pHash are not rotation- or mirror-invariant (PLAN.md §10.2's
 * comment on dHash applies to pHash too, just less severely), so a
 * genuinely 180-degree-rotated or mirrored derivative will not be found by
 * `generateCandidatePairs`'s plain-orientation search — it simply never
 * becomes a candidate, and the confirmation step in M5 never gets a
 * chance to run on it (confirmation only ever revisits *existing*
 * candidates). This computes hashes for the rotated/mirrored versions of
 * each image too, so `generateCandidatePairs` can search under those as
 * well. Not persisted (recomputed each run) — keeping this out of the
 * schema avoids coupling storage to a detection strategy that later
 * milestones may replace with a properly orientation-invariant hash.
 *
 * Deduplicated by SHA-256 like `computeMissingHashes`: byte-identical
 * files produce identical variant hashes, so only one representative per
 * distinct content hash is actually decoded.
 */
export async function computeOrientationVariants(
  records: readonly ImageRecord[],
  concurrency: number,
): Promise<Map<string, OrientationHashVariant[]>> {
  const bySha256 = new Map<string, ImageRecord[]>();
  for (const record of records) {
    const bucket = bySha256.get(record.file.sha256);
    if (bucket) {
      bucket.push(record);
    } else {
      bySha256.set(record.file.sha256, [record]);
    }
  }

  const result = new Map<string, OrientationHashVariant[]>();
  const limit = pLimit(concurrency);

  await Promise.all(
    [...bySha256.values()].map((group) =>
      limit(async () => {
        const [representative] = group;
        if (!representative) {
          return;
        }
        const variants = await Promise.all(
          ORIENTATION_TRANSFORMS.map(async (transform) => {
            const [dHash, pHash] = await Promise.all([
              computeDifferenceHash(representative.realPath, transform),
              computePerceptualHash(representative.realPath, transform),
            ]);
            return { transform, dHash, pHash };
          }),
        );
        for (const record of group) {
          result.set(record.id, variants);
        }
      }),
    ),
  );

  return result;
}
