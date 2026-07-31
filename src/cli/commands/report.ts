import type { Command } from "commander";
import { notImplemented } from "./not-implemented.js";

export function registerReportCommand(program: Command): void {
  program
    .command("report")
    .description("Generate JSON and static HTML reports from an audit workspace.")
    .option("--workspace <path>", "Audit workspace")
    .option("--format <format>", "Output format: text or json", "text")
    .option("--pretty", "Pretty-print JSON output")
    .option("--verbose", "Show additional processing information")
    .option("--debug", "Show diagnostic information")
    .action(() => {
      notImplemented("report", "M8 (https://github.com/davidsneighbour/image-dedup/issues/9)");
    });
}
