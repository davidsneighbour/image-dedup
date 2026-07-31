import sharp from "sharp";

/**
 * Whether `path` has alpha values that actually vary (as opposed to a
 * technically-present but fully-opaque alpha channel). Only relevant when
 * the record's own metadata already says it has an alpha channel — this
 * never decodes files that don't.
 */
async function hasMeaningfulAlpha(path: string, recordHasAlpha: boolean): Promise<boolean> {
  if (!recordHasAlpha) {
    return false;
  }
  const stats = await sharp(path).stats();
  const alphaChannel = stats.channels.at(-1);
  return alphaChannel !== undefined && alphaChannel.min < 250;
}

export interface AlphaComparisonResult {
  aHasMeaningfulAlpha: boolean;
  bHasMeaningfulAlpha: boolean;
  /** One candidate has real transparency the other lacks (PLAN.md §11.2). */
  mismatch: boolean;
}

/**
 * Compares transparency between two candidates without flattening either
 * against a background colour first (PLAN.md §11.2: "do not flatten both
 * against white and declare them identical").
 */
export async function compareAlpha(
  pathA: string,
  aHasAlpha: boolean,
  pathB: string,
  bHasAlpha: boolean,
): Promise<AlphaComparisonResult> {
  const [aHasMeaningfulAlpha, bHasMeaningfulAlpha] = await Promise.all([
    hasMeaningfulAlpha(pathA, aHasAlpha),
    hasMeaningfulAlpha(pathB, bHasAlpha),
  ]);
  return {
    aHasMeaningfulAlpha,
    bHasMeaningfulAlpha,
    mismatch: aHasMeaningfulAlpha !== bHasMeaningfulAlpha,
  };
}
