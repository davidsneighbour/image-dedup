import sharp from "sharp";

/**
 * Mean absolute difference between the two images' per-channel (RGB) means,
 * on a 0-255 scale. Cheap (uses sharp's `.stats()`, no pixel-level
 * comparison), used only as a coarse signal for the "colour-adjusted"
 * relationship (PLAN.md §15) — not a substitute for real histogram
 * comparison.
 */
export async function meanColourDelta(pathA: string, pathB: string): Promise<number> {
  const [statsA, statsB] = await Promise.all([sharp(pathA).stats(), sharp(pathB).stats()]);
  const channelCount = Math.min(statsA.channels.length, statsB.channels.length, 3);
  if (channelCount === 0) {
    return 0;
  }

  let total = 0;
  for (let i = 0; i < channelCount; i++) {
    const meanA = statsA.channels[i]?.mean ?? 0;
    const meanB = statsB.channels[i]?.mean ?? 0;
    total += Math.abs(meanA - meanB);
  }
  return total / channelCount;
}
