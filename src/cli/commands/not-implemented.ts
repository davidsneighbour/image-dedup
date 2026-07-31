import { CliError, ExitCode } from "../exit-codes.js";

/**
 * Shared guard for commands whose implementation is scoped to a later
 * milestone (see RESTART.md / the milestone issues on GitHub). Commands
 * still register their full option set and `--help` text now, per
 * PLAN.md §36 ("Every command must support --help"), even before the
 * underlying logic exists.
 */
export function notImplemented(commandName: string, milestoneIssue: string): never {
  throw new CliError(
    `\`image-origin ${commandName}\` is not implemented yet (tracked in ${milestoneIssue}).`,
    ExitCode.commandFailed,
    "This command is planned but not yet built. See PLAN.md and the linked GitHub issue for scope.",
  );
}
