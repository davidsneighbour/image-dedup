import type { Command } from "commander";
import { loadConfig } from "../../config/load-config.js";
import { readResolvedConfig } from "../../config/resolved-config-file.js";
import type { ImageOriginConfig, ImageOriginConfigInput } from "../../config/schema.js";
import { runConsolidation } from "../../consolidation/run-consolidation.js";
import { ExitCode } from "../exit-codes.js";
import { type LogLevel, Logger, type OutputFormat } from "../output.js";

interface ConsolidateCliOptions {
  config?: string;
  workspace: string;
  originals: string;
  apply?: boolean;
  yes?: boolean;
  format: OutputFormat;
  verbose?: boolean;
  debug?: boolean;
  quiet?: boolean;
}

function resolveLogLevel(options: ConsolidateCliOptions): LogLevel {
  if (options.debug) return "debug";
  if (options.verbose) return "verbose";
  if (options.quiet) return "quiet";
  return "normal";
}

/**
 * Like `report`'s `resolveReportConfig` (`src/cli/commands/report.ts`):
 * `consolidate` operates on an existing workspace rather than rescanning,
 * so it prefers the config `audit` already resolved and persisted there,
 * falling back to loading `--config`/defaults if that's absent.
 */
async function resolveConsolidateConfig(
  options: ConsolidateCliOptions,
): Promise<ImageOriginConfig> {
  if (!options.config) {
    const resolved = await readResolvedConfig(options.workspace);
    if (resolved) {
      return { ...resolved, workspace: options.workspace, originalsDirectory: options.originals };
    }
  }

  const overrides: Partial<ImageOriginConfigInput> = {
    workspace: options.workspace,
    originalsDirectory: options.originals,
  };

  return loadConfig({
    ...(options.config ? { configPath: options.config } : {}),
    overrides,
  });
}

export function registerConsolidateCommand(program: Command): void {
  program
    .command("consolidate")
    .description("Copy approved originals into the canonical originals directory.")
    .option("--config <path>", "Configuration file")
    .requiredOption("--workspace <path>", "Audit workspace")
    .requiredOption("--originals <path>", "Canonical originals directory")
    .option("--dry-run", "Print and save a plan only (default)")
    .option("--apply", "Permit mutations (copy files)")
    .option("--yes", "Suppress interactive confirmation (does not imply --apply)")
    .option("--format <format>", "Output format: text or json", "text")
    .option("--verbose", "Show additional processing information")
    .option("--debug", "Show diagnostic information")
    .option("--quiet", "Suppress non-essential output")
    .action(async (options: ConsolidateCliOptions) => {
      const logger = new Logger({ level: resolveLogLevel(options), format: options.format });

      const config = await resolveConsolidateConfig(options);

      if (options.verbose || options.debug) {
        logger.verbose("Resolved configuration", { config });
      }

      const result = await runConsolidation({
        config,
        apply: Boolean(options.apply),
        logger,
      });

      if (options.format === "json") {
        process.stdout.write(
          `${JSON.stringify({
            runId: result.runId,
            originalsDirectory: result.originalsDirectory,
            planned: result.planned.length,
            unresolvedGroupIds: result.unresolvedGroupIds,
            manifestPreviewPath: result.manifestPreviewPath,
            manifestPath: result.manifestPath,
            verified: result.operations.filter((op) => op.status === "verified").length,
            failed: result.failedOperations.length,
          })}\n`,
        );
      }

      if (result.failedOperations.length > 0) {
        process.exitCode = ExitCode.verificationFailed;
      }
    });
}
