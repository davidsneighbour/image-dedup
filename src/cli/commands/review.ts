import type { Command } from "commander";
import { importReviewDecisions } from "../../review/import-decisions.js";
import { CliError, ExitCode } from "../exit-codes.js";
import { type LogLevel, Logger, type OutputFormat } from "../output.js";

interface ReviewImportCliOptions {
  workspace: string;
  decisions: string;
  forceStaleDecisions?: boolean;
  format: OutputFormat;
  verbose?: boolean;
  debug?: boolean;
  quiet?: boolean;
}

function resolveLogLevel(options: ReviewImportCliOptions): LogLevel {
  if (options.debug) return "debug";
  if (options.verbose) return "verbose";
  if (options.quiet) return "quiet";
  return "normal";
}

export function registerReviewCommand(program: Command): void {
  // Deliberately no `--workspace` option here: commander resolves an
  // option declared on a parent command against the whole remaining
  // argument list, including `import`'s own flags — a parent-level
  // `--workspace` silently "claims" the value meant for `import`'s
  // `requiredOption`, which then always reports as missing. Confirmed by
  // manually running the built CLI (`review import --workspace ... `
  // failed with "required option '--workspace <path>' not specified"
  // despite it clearly being passed) — not caught by `--help` output or
  // any test, since nothing had exercised the real parse path before.
  const review = program
    .command("review")
    .description("Review audit groups and import human decisions.")
    .action(() => {
      throw new CliError(
        "`image-origin review` has no standalone behaviour of its own — the review UI is the static HTML report.",
        ExitCode.commandFailed,
        "Run `image-origin report --workspace <path>` and open the generated report/index.html in a browser to review groups and export decisions, then run `image-origin review import` to apply them.",
      );
    });

  review
    .command("import")
    .description("Validate and import a decisions.json file exported from the HTML review report.")
    .requiredOption("--workspace <path>", "Audit workspace")
    .requiredOption("--decisions <path>", "Path to decisions.json")
    .option(
      "--force-stale-decisions",
      "Apply decisions even if group membership has changed since export",
    )
    .option("--format <format>", "Output format: text or json", "text")
    .option("--verbose", "Show additional processing information")
    .option("--debug", "Show diagnostic information")
    .option("--quiet", "Suppress non-essential output")
    .action(async (options: ReviewImportCliOptions) => {
      const logger = new Logger({ level: resolveLogLevel(options), format: options.format });

      const result = await importReviewDecisions({
        workspace: options.workspace,
        decisionsPath: options.decisions,
        forceStaleDecisions: Boolean(options.forceStaleDecisions),
        logger,
      });

      logger.info(`Applied ${result.applied.length} of ${result.totalDecisions} decision(s).`);
      if (result.skippedStale.length > 0) {
        logger.info(
          `Skipped ${result.skippedStale.length} stale decision(s) that no longer apply to current group membership.`,
        );
      }

      if (options.format === "json") {
        process.stdout.write(
          `${JSON.stringify({
            totalDecisions: result.totalDecisions,
            applied: result.applied.length,
            skippedStale: result.skippedStale,
          })}\n`,
        );
      }
    });
}
