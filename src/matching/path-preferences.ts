import picomatch from "picomatch";
import type { ImageOriginConfig } from "../config/schema.js";

export type PathPreference = ImageOriginConfig["pathPreferences"][number];

/**
 * Sums the weights of every configured pattern that matches `relativePath`.
 * See PLAN.md §9's example: `backups/originals/**` weighted `+20`,
 * `public/generated/**` weighted `-20`. A path matching neither scores 0.
 */
export function scorePathPreference(
  relativePath: string,
  preferences: readonly PathPreference[],
): number {
  const posixPath = relativePath.split("\\").join("/");
  let score = 0;
  for (const preference of preferences) {
    const isMatch = picomatch(preference.pattern, { dot: true });
    if (isMatch(posixPath)) {
      score += preference.weight;
    }
  }
  return score;
}
