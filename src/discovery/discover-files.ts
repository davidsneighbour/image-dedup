import { open, realpath } from "node:fs/promises";
import { join, relative } from "node:path";
import fg from "fast-glob";
import { buildIgnorePatterns, resolveInputDirectory } from "./ignore-rules.js";
import {
  MAGIC_BYTES_SNIFF_LENGTH,
  type SupportedFormat,
  formatFromContent,
  formatFromExtension,
} from "./supported-formats.js";

export type DiscoveryStatus =
  | "discovered"
  | "ignored"
  | "unsupported"
  | "inaccessible"
  | "duplicate-path"
  | "symlink-skipped";

export interface DiscoveryEntry {
  /** Path as encountered on disk, relative to its input directory's parent (stable, human-readable). */
  path: string;
  /** Absolute path as encountered on disk (may itself be a symlink). */
  absolutePath: string;
  /** Fully resolved, symlink-free absolute path. Absent when resolution failed. */
  realPath?: string;
  inputDirectory: string;
  status: DiscoveryStatus;
  format?: SupportedFormat;
  reason?: string;
}

export interface DiscoverFilesOptions {
  inputs: string[];
  include: string[];
  exclude: string[];
  followSymlinks: boolean;
  workspace: string;
}

async function sniffFormat(absolutePath: string): Promise<SupportedFormat | undefined> {
  const handle = await open(absolutePath, "r");
  try {
    const buffer = Buffer.alloc(MAGIC_BYTES_SNIFF_LENGTH);
    const { bytesRead } = await handle.read(buffer, 0, MAGIC_BYTES_SNIFF_LENGTH, 0);
    return formatFromContent(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

/**
 * Walks all configured input directories and classifies every candidate
 * file. Deterministic: results are sorted by input directory then path.
 * See PLAN.md §7.
 */
export async function discoverFiles(options: DiscoverFilesOptions): Promise<DiscoveryEntry[]> {
  const entries: DiscoveryEntry[] = [];
  const seenRealPaths = new Map<string, string>();

  for (const rawInputDir of options.inputs) {
    const inputDir = resolveInputDirectory(rawInputDir);
    const ignore = buildIgnorePatterns(inputDir, options.exclude, options.workspace);

    // `onlyFiles: false` + `followSymbolicLinks: false` + `stats: false` makes
    // fast-glob classify entries from `lstat` (never resolving symlink
    // targets itself), so a symlink — including a self-referential one that
    // would make `stat` throw ELOOP — still comes back as a plain entry
    // instead of vanishing or hanging the walk. Resolution and loop
    // detection happen explicitly below via `realpath`.
    const matches = await fg(options.include, {
      cwd: inputDir,
      ignore,
      onlyFiles: false,
      dot: true,
      unique: true,
      followSymbolicLinks: false,
      suppressErrors: true,
      caseSensitiveMatch: false,
      objectMode: true,
      stats: false,
    });

    const fileMatches = matches
      .filter((match) => !match.dirent.isDirectory())
      .map((match) => match.path)
      .sort((a, b) => a.localeCompare(b));

    for (const match of fileMatches) {
      const absolutePath = join(inputDir, match);
      const displayPath = relative(process.cwd(), absolutePath) || absolutePath;

      const entry: DiscoveryEntry = {
        path: displayPath,
        absolutePath,
        inputDirectory: inputDir,
        status: "discovered",
      };

      let resolvedRealPath: string;
      try {
        resolvedRealPath = await realpath(absolutePath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ELOOP") {
          entries.push({ ...entry, status: "symlink-skipped", reason: "symlink loop detected" });
          continue;
        }
        entries.push({
          ...entry,
          status: "inaccessible",
          reason: (error as Error).message,
        });
        continue;
      }

      const isSymlink = resolvedRealPath !== absolutePath;
      if (isSymlink && !options.followSymlinks) {
        entries.push({
          ...entry,
          realPath: resolvedRealPath,
          status: "symlink-skipped",
          reason: "symlinks disabled by configuration",
        });
        continue;
      }

      const previousPath = seenRealPaths.get(resolvedRealPath);
      if (previousPath !== undefined) {
        entries.push({
          ...entry,
          realPath: resolvedRealPath,
          status: "duplicate-path",
          reason: `same file already discovered at ${previousPath}`,
        });
        continue;
      }
      seenRealPaths.set(resolvedRealPath, displayPath);

      const extensionFormat = formatFromExtension(absolutePath);
      let contentFormat: SupportedFormat | undefined;
      try {
        contentFormat = await sniffFormat(resolvedRealPath);
      } catch (error) {
        entries.push({
          ...entry,
          realPath: resolvedRealPath,
          status: "inaccessible",
          reason: (error as Error).message,
        });
        continue;
      }

      const format = contentFormat ?? extensionFormat;
      if (!format) {
        entries.push({ ...entry, realPath: resolvedRealPath, status: "unsupported" });
        continue;
      }

      const warnExtensionMismatch =
        extensionFormat !== undefined &&
        contentFormat !== undefined &&
        extensionFormat !== contentFormat;

      entries.push({
        ...entry,
        realPath: resolvedRealPath,
        status: "discovered",
        format,
        ...(warnExtensionMismatch
          ? { reason: `extension suggests ${extensionFormat}, content is ${contentFormat}` }
          : {}),
      });
    }
  }

  return entries;
}
