import type { Command } from "commander";
import { notImplemented } from "./not-implemented.js";

export function registerReviewCommand(program: Command): void {
  const review = program
    .command("review")
    .description("Review audit groups and import human decisions.")
    .option("--workspace <path>", "Audit workspace")
    .action(() => {
      notImplemented("review", "M8 (https://github.com/davidsneighbour/image-dedup/issues/9)");
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
    .action(() => {
      notImplemented(
        "review import",
        "M9 (https://github.com/davidsneighbour/image-dedup/issues/10)",
      );
    });
}
