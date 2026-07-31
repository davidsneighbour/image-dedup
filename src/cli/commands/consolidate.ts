import type { Command } from "commander";
import { notImplemented } from "./not-implemented.js";

export function registerConsolidateCommand(program: Command): void {
  program
    .command("consolidate")
    .description("Copy approved originals into the canonical originals directory.")
    .requiredOption("--workspace <path>", "Audit workspace")
    .requiredOption("--originals <path>", "Canonical originals directory")
    .option("--dry-run", "Print and save a plan only (default)")
    .option("--apply", "Permit mutations (copy files)")
    .option("--yes", "Suppress interactive confirmation (does not imply --apply)")
    .action(() => {
      notImplemented(
        "consolidate",
        "M10 (https://github.com/davidsneighbour/image-dedup/issues/11)",
      );
    });
}
