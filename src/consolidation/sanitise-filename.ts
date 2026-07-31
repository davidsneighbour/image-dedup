/**
 * Filename/path-component sanitisation for canonical path planning
 * (PLAN.md §22.2). Kept deliberately conservative: replace what's actually
 * unsafe rather than reformatting names a reviewer might recognise.
 */

// Control characters plus the classic Windows/POSIX-unsafe set. `/` and
// `\` are never expected inside a single path *component* (callers split
// on them first) but are included defensively.
// biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately matching them to strip
const UNSAFE_CHARACTERS = /[\x00-\x1f<>:"/\\|?*]/g;

/** Sanitises one path component (a single filename or directory segment, not a full path). */
export function sanitiseFilenameComponent(component: string): string {
  const replaced = component
    .replace(UNSAFE_CHARACTERS, "-")
    .replace(/\s+/g, " ")
    .trim()
    // Trailing dots/spaces are rejected outright by Windows; strip defensively everywhere.
    .replace(/[. ]+$/, "")
    .replace(/^[. ]+/, "");

  return replaced.length > 0 ? replaced : "untitled";
}

/**
 * Slugifies a path component: lowercase, diacritics stripped, anything
 * outside `[a-z0-9]` collapsed to a single hyphen. Used by the
 * `sanitised-filename` and `date-slug` naming strategies.
 */
export function slugify(component: string): string {
  const slug = component
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug.length > 0 ? slug : "image";
}

/**
 * Normalises a relative path for collision comparison: case-insensitive
 * and Unicode-normalisation-insensitive (PLAN.md §22.2: "avoid
 * case-insensitive collisions" / "detect Unicode-normalisation
 * collisions"), and separator-insensitive so the check doesn't depend on
 * the host OS's path separator.
 */
export function collisionKey(relativePath: string): string {
  return relativePath.split("\\").join("/").normalize("NFC").toLowerCase();
}

/** Inserts a short suffix before the extension: `dir/name.ext` -> `dir/name-<suffix>.ext`. */
export function appendSuffixToBasename(relativePath: string, suffix: string): string {
  const segments = relativePath.split("/");
  const last = segments.pop() ?? "";
  const dotIndex = last.lastIndexOf(".");
  const withSuffix =
    dotIndex > 0
      ? `${last.slice(0, dotIndex)}-${suffix}${last.slice(dotIndex)}`
      : `${last}-${suffix}`;
  return [...segments, withSuffix].join("/");
}
