import type { Command } from "commander";
import { notImplemented } from "./not-implemented.js";

export function registerVerifyCommand(program: Command): void {
  program
    .command("verify")
    .description(
      "Verify consolidated files, replaced references, and configured repository checks.",
    )
    .requiredOption("--workspace <path>", "Audit workspace")
    .requiredOption("--originals <path>", "Canonical originals directory")
    .action(() => {
      notImplemented("verify", "M12 (https://github.com/davidsneighbour/image-dedup/issues/13)");
    });
}
