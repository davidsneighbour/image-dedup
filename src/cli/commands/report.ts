import type { Command } from "commander";
import { loadConfig } from "../../config/load-config.js";
import { readResolvedConfig } from "../../config/resolved-config-file.js";
import type { ImageOriginConfig, ImageOriginConfigInput } from "../../config/schema.js";
import { generateReport } from "../../reporting/generate-report.js";
import { type LogLevel, Logger, type OutputFormat } from "../output.js";

interface ReportCliOptions {
  config?: string;
  workspace?: string;
  format: OutputFormat;
  pretty?: boolean;
  absolutePaths?: boolean;
  verbose?: boolean;
  debug?: boolean;
  quiet?: boolean;
}

function resolveLogLevel(options: ReportCliOptions): LogLevel {
  if (options.debug) return "debug";
  if (options.verbose) return "verbose";
  if (options.quiet) return "quiet";
  return "normal";
}

/**
 * `report` reads an existing workspace rather than re-scanning, so unlike
 * `audit` it doesn't need `--input`/`--config` on every invocation: if no
 * `--config` was given, it first tries the configuration `audit` already
 * persisted into the workspace (PLAN.md §6's `config.resolved.json`).
 * Falls back to the normal `loadConfig` contract (which requires
 * `--config` or otherwise-resolvable `inputs`) when that's absent — e.g.
 * a workspace from before this existed, or one whose report is being
 * regenerated with a different config file on purpose.
 */
async function resolveReportConfig(options: ReportCliOptions): Promise<ImageOriginConfig> {
  const overrides: Partial<ImageOriginConfigInput> = {};
  if (options.workspace) {
    overrides.workspace = options.workspace;
  }

  if (!options.config) {
    const workspace = options.workspace ?? "./.image-origin";
    const resolved = await readResolvedConfig(workspace);
    if (resolved) {
      return options.workspace ? { ...resolved, workspace: options.workspace } : resolved;
    }
  }

  return loadConfig({
    ...(options.config ? { configPath: options.config } : {}),
    overrides,
  });
}

export function registerReportCommand(program: Command): void {
  program
    .command("report")
    .description("Generate JSON and static HTML reports from an audit workspace.")
    .option("--config <path>", "Configuration file")
    .option("--workspace <path>", "Audit workspace")
    .option("--format <format>", "Output format: text or json", "text")
    .option("--pretty", "Pretty-print the JSON report")
    .option(
      "--absolute-paths",
      "Include absolute filesystem paths in the JSON report (omitted by default)",
    )
    .option("--verbose", "Show additional processing information")
    .option("--debug", "Show diagnostic information")
    .option("--quiet", "Suppress non-essential output")
    .action(async (options: ReportCliOptions) => {
      const logger = new Logger({ level: resolveLogLevel(options), format: options.format });

      const config = await resolveReportConfig(options);

      if (options.verbose || options.debug) {
        logger.verbose("Resolved configuration", { config });
      }

      const result = await generateReport({
        config,
        logger,
        absolutePaths: Boolean(options.absolutePaths),
        pretty: Boolean(options.pretty),
      });

      if (options.format === "json") {
        process.stdout.write(
          `${JSON.stringify({
            auditJsonPath: result.auditJsonPath,
            htmlReportPath: result.htmlReportPath,
            summary: result.report.summary,
          })}\n`,
        );
      }
    });
}
