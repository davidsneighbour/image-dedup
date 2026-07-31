import type { Command } from "commander";
import { notImplemented } from "./not-implemented.js";

export function registerReferencesCommand(program: Command): void {
  program
    .command("references")
    .description("Find and optionally replace source-code references to deprecated image paths.")
    .requiredOption("--workspace <path>", "Audit workspace")
    .requiredOption("--root <path>", "Repository root to search for references")
    .option("--dry-run", "Print patches only, without writing (default)")
    .option("--apply", "Permit mutations (rewrite source files)")
    .action(() => {
      notImplemented(
        "references",
        "M11/M12 (https://github.com/davidsneighbour/image-dedup/issues/12)",
      );
    });
}
