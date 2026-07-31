import type { Command } from "commander";
import { rollbackConsolidation } from "../../consolidation/rollback-consolidation.js";
import { type LogLevel, Logger, type OutputFormat } from "../output.js";

interface RollbackCliOptions {
  workspace: string;
  run?: string;
  apply?: boolean;
  format: OutputFormat;
  verbose?: boolean;
  debug?: boolean;
  quiet?: boolean;
}

function resolveLogLevel(options: RollbackCliOptions): LogLevel {
  if (options.debug) return "debug";
  if (options.verbose) return "verbose";
  if (options.quiet) return "quiet";
  return "normal";
}

/**
 * A separate top-level command rather than `consolidate rollback` —
 * nesting it would give `consolidate` its own `--workspace` (needed by
 * its default action) *and* a child command needing the same option,
 * which is exactly the parent/child option-shadowing bug hit and fixed in
 * M9 (see `src/cli/commands/review.ts`'s comment). Keeping this flat
 * avoids reintroducing it.
 */
export function registerRollbackCommand(program: Command): void {
  program
    .command("rollback")
    .description("Undo files copied by a previous `consolidate --apply` run.")
    .requiredOption("--workspace <path>", "Audit workspace")
    .option("--run <runId>", "Run id to roll back (defaults to the most recent run)")
    .option(
      "--apply",
      "Permit mutations (remove files); without it, only reports what would be removed",
    )
    .option("--format <format>", "Output format: text or json", "text")
    .option("--verbose", "Show additional processing information")
    .option("--debug", "Show diagnostic information")
    .option("--quiet", "Suppress non-essential output")
    .action(async (options: RollbackCliOptions) => {
      const logger = new Logger({ level: resolveLogLevel(options), format: options.format });

      const result = await rollbackConsolidation({
        workspace: options.workspace,
        ...(options.run ? { runId: options.run } : {}),
        apply: Boolean(options.apply),
        logger,
      });

      if (options.format === "json") {
        process.stdout.write(
          `${JSON.stringify({
            runId: result.runId,
            removed: result.removed.length,
            skipped: result.skipped.length,
          })}\n`,
        );
      }
    });
}
