import { pathToFileURL } from "node:url";
import { CliError, ExitCode } from "../cli/exit-codes.js";
import { formatZodError } from "../cli/format-zod-error.js";
import { type ImageOriginConfig, type ImageOriginConfigInput, configSchema } from "./schema.js";

export interface LoadConfigOptions {
  /** Path to a `.mjs`/`.js`/`.json` config file with a default export. */
  configPath?: string;
  /** CLI-provided overrides, shallow-merged over the file config before validation. */
  overrides?: Partial<ImageOriginConfigInput>;
}

async function readConfigFile(configPath: string): Promise<unknown> {
  try {
    const moduleUrl = pathToFileURL(configPath).href;
    const imported = (await import(moduleUrl)) as { default?: unknown };
    if (imported.default === undefined) {
      throw new CliError(
        `Configuration file "${configPath}" has no default export.`,
        ExitCode.invalidConfiguration,
        "Export the configuration object with `export default { ... }`.",
      );
    }
    return imported.default;
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    throw new CliError(
      `Failed to load configuration file "${configPath}": ${(error as Error).message}`,
      ExitCode.invalidConfiguration,
      "Check that the file exists and is valid ESM/JSON.",
    );
  }
}

/**
 * Loads, merges, and validates configuration. Never mutates the filesystem.
 * Throws a `CliError` with `ExitCode.invalidConfiguration` on any problem so
 * callers can surface a consistent, actionable error.
 */
export async function loadConfig(options: LoadConfigOptions): Promise<ImageOriginConfig> {
  const fileConfig = options.configPath ? await readConfigFile(options.configPath) : {};

  if (typeof fileConfig !== "object" || fileConfig === null || Array.isArray(fileConfig)) {
    throw new CliError(
      "Configuration must be a plain object.",
      ExitCode.invalidConfiguration,
      "Export a single configuration object, e.g. `export default { inputs: [...] }`.",
    );
  }

  const merged = { ...(fileConfig as Record<string, unknown>), ...(options.overrides ?? {}) };

  const result = configSchema.safeParse(merged);
  if (!result.success) {
    throw new CliError(
      `Invalid configuration:\n${formatZodError(result.error)}`,
      ExitCode.invalidConfiguration,
      "Fix the reported fields and re-run. Use --verbose to print the fully resolved configuration.",
    );
  }

  return result.data;
}
