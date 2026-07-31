import { isAbsolute, join, relative, resolve, sep } from "node:path";

/**
 * Builds the effective glob ignore patterns for a given input directory:
 * the configured `exclude` patterns, plus an implicit exclusion of the
 * resolved workspace directory (PLAN.md §7.1, "avoid reading generated
 * report files") when it happens to sit inside that input directory.
 */
export function buildIgnorePatterns(
  inputDir: string,
  exclude: readonly string[],
  workspace: string,
): string[] {
  const patterns = [...exclude];

  const absoluteInputDir = resolve(inputDir);
  const absoluteWorkspace = resolve(workspace);
  const relativeToInput = relative(absoluteInputDir, absoluteWorkspace);

  const isInsideInputDir =
    relativeToInput !== "" && !relativeToInput.startsWith("..") && !isAbsolute(relativeToInput);

  if (isInsideInputDir) {
    const posixRelative = relativeToInput.split(sep).join("/");
    patterns.push(`${posixRelative}/**`, posixRelative);
  }

  return patterns;
}

export function resolveInputDirectory(inputDir: string, cwd = process.cwd()): string {
  return isAbsolute(inputDir) ? inputDir : join(cwd, inputDir);
}
