#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { registerAuditCommand } from "./commands/audit.js";
import { registerConsolidateCommand } from "./commands/consolidate.js";
import { registerReferencesCommand } from "./commands/references.js";
import { registerReportCommand } from "./commands/report.js";
import { registerReviewCommand } from "./commands/review.js";
import { registerVerifyCommand } from "./commands/verify.js";
import { CliError, ExitCode } from "./exit-codes.js";
import { Logger } from "./output.js";
import { readPackageVersion } from "./package-version.js";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("image-origin")
    .description(
      "Audit historical website image assets, detect duplicate/derivative relationships, " +
        "and consolidate curated originals into a canonical directory.",
    )
    .version(readPackageVersion());

  registerAuditCommand(program);
  registerReportCommand(program);
  registerReviewCommand(program);
  registerConsolidateCommand(program);
  registerReferencesCommand(program);
  registerVerifyCommand(program);

  return program;
}

async function main(): Promise<void> {
  const program = createProgram();

  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    const logger = new Logger();
    if (error instanceof CliError) {
      logger.error({
        phase: "cli",
        operation: "command execution",
        error: error.message,
        continued: false,
        ...(error.remediation ? { remediation: error.remediation } : {}),
      });
      process.exitCode = error.exitCode;
      return;
    }
    logger.error({
      phase: "cli",
      operation: "command execution",
      error: error instanceof Error ? error.message : String(error),
      continued: false,
    });
    process.exitCode = ExitCode.commandFailed;
  }
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  void main();
}
