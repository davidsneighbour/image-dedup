import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type ImageOriginConfig, configSchema } from "./schema.js";

const RESOLVED_CONFIG_FILENAME = "config.resolved.json";

function resolvedConfigPath(workspace: string): string {
  return join(workspace, RESOLVED_CONFIG_FILENAME);
}

/**
 * Persists the fully-resolved configuration inside the workspace (PLAN.md
 * §6's workspace layout lists `config.resolved.json` explicitly), so later
 * commands that operate on an existing workspace (e.g. `report`) can
 * reconstruct the same configuration without requiring `--config`/`--input`
 * to be supplied again on every invocation.
 */
export async function writeResolvedConfig(config: ImageOriginConfig): Promise<void> {
  await mkdir(config.workspace, { recursive: true });
  await writeFile(
    resolvedConfigPath(config.workspace),
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8",
  );
}

/**
 * Returns the previously resolved config for `workspace`, or `undefined`
 * if none was ever written (workspace doesn't exist, predates this
 * feature, or no longer validates against the current schema — treated as
 * absent rather than a hard error, since callers fall back to requiring
 * an explicit `--config` in that case).
 */
export async function readResolvedConfig(
  workspace: string,
): Promise<ImageOriginConfig | undefined> {
  let raw: string;
  try {
    raw = await readFile(resolvedConfigPath(workspace), "utf8");
  } catch {
    return undefined;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return undefined;
  }

  const result = configSchema.safeParse(parsedJson);
  return result.success ? result.data : undefined;
}
