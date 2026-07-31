import type { Command } from "commander";
import { loadConfig } from "../../config/load-config.js";
import { writeResolvedConfig } from "../../config/resolved-config-file.js";
import type { ImageOriginConfigInput } from "../../config/schema.js";
import { type LogLevel, Logger, type OutputFormat } from "../output.js";

interface AuditCliOptions {
  config?: string;
  input?: string[];
  workspace?: string;
  force?: boolean;
  nonInteractive?: boolean;
  format: OutputFormat;
  verbose?: boolean;
  debug?: boolean;
  quiet?: boolean;
}

function resolveLogLevel(options: AuditCliOptions): LogLevel {
  if (options.debug) return "debug";
  if (options.verbose) return "verbose";
  if (options.quiet) return "quiet";
  return "normal";
}

export function registerAuditCommand(program: Command): void {
  program
    .command("audit")
    .description(
      "Scan image directories, calculate image fingerprints, detect related files, and produce source-quality recommendations.",
    )
    .option("--config <path>", "Configuration file")
    .option(
      "--input <path>",
      "Input directory; repeatable",
      (value: string, previous: string[]) => [...previous, value],
      [] as string[],
    )
    .option("--workspace <path>", "Audit workspace")
    .option("--force", "Recalculate cached records")
    .option("--non-interactive", "Disable prompts")
    .option("--format <format>", "Output format: text or json", "text")
    .option("--verbose", "Show additional processing information")
    .option("--debug", "Show diagnostic information")
    .option("--quiet", "Suppress non-essential output")
    .action(async (options: AuditCliOptions) => {
      const logger = new Logger({ level: resolveLogLevel(options), format: options.format });

      const overrides: Partial<ImageOriginConfigInput> = {};
      if (options.input && options.input.length > 0) {
        overrides.inputs = options.input;
      }
      if (options.workspace) {
        overrides.workspace = options.workspace;
      }

      const config = await loadConfig({
        ...(options.config ? { configPath: options.config } : {}),
        overrides,
      });

      if (options.verbose || options.debug) {
        logger.verbose("Resolved configuration", { config });
      }

      // Persisted so later commands (e.g. `report`) can reconstruct this
      // same configuration from the workspace alone (PLAN.md §6).
      await writeResolvedConfig(config);

      const { runAudit } = await import("../../discovery/run-audit.js");
      await runAudit({ config, logger, force: Boolean(options.force) });
    });
}
