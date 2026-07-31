/**
 * Exit code contract for every CLI command.
 * See PLAN.md §29.3.
 */
export const ExitCode = {
  success: 0,
  commandFailed: 1,
  reviewRequired: 2,
  verificationFailed: 3,
  invalidConfiguration: 4,
  unsafeOperationRefused: 5,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

export class CliError extends Error {
  readonly exitCode: ExitCode;
  readonly remediation: string | undefined;

  constructor(message: string, exitCode: ExitCode, remediation?: string) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
    this.remediation = remediation;
  }
}
