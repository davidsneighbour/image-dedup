/**
 * CLI output/logging. See PLAN.md §29.
 *
 * Text levels are ordered quiet < normal < verbose < debug; each level
 * shows everything from the levels below it. "json" is a separate output
 * format, not a verbosity level: when active, structured events are
 * written as one JSON object per line to stdout instead of formatted text.
 */
export type LogLevel = "quiet" | "normal" | "verbose" | "debug";
export type OutputFormat = "text" | "json";

const LEVEL_ORDER: Record<LogLevel, number> = {
  quiet: 0,
  normal: 1,
  verbose: 2,
  debug: 3,
};

export interface LoggerOptions {
  level?: LogLevel;
  format?: OutputFormat;
}

export interface ErrorReport {
  phase: string;
  filePath?: string;
  operation: string;
  error: string;
  continued: boolean;
  remediation?: string;
}

export class Logger {
  readonly level: LogLevel;
  readonly format: OutputFormat;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? "normal";
    this.format = options.format ?? "text";
  }

  private isEnabled(minLevel: LogLevel): boolean {
    return LEVEL_ORDER[this.level] >= LEVEL_ORDER[minLevel];
  }

  private write(
    payload: Record<string, unknown>,
    text: string,
    minLevel: LogLevel,
    data?: Record<string, unknown>,
  ): void {
    if (!this.isEnabled(minLevel)) {
      return;
    }
    if (this.format === "json") {
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return;
    }
    const suffix = data && Object.keys(data).length > 0 ? `\n${JSON.stringify(data, null, 2)}` : "";
    process.stdout.write(`${text}${suffix}\n`);
  }

  /** Always shown unless level is "quiet". */
  info(message: string, data?: Record<string, unknown>): void {
    this.write({ level: "info", message, ...data }, message, "normal", data);
  }

  /** Only shown at "verbose" or higher. */
  verbose(message: string, data?: Record<string, unknown>): void {
    this.write({ level: "verbose", message, ...data }, message, "verbose", data);
  }

  /** Only shown at "debug". */
  debug(message: string, data?: Record<string, unknown>): void {
    this.write({ level: "debug", message, ...data }, `[debug] ${message}`, "debug", data);
  }

  /** Errors are always shown, even at "quiet", and always go to stderr. */
  error(report: ErrorReport): void {
    if (this.format === "json") {
      process.stderr.write(`${JSON.stringify({ level: "error", ...report })}\n`);
      return;
    }
    const location = report.filePath ? ` (${report.filePath})` : "";
    let line = `error [${report.phase}] ${report.operation}${location}: ${report.error}`;
    if (report.remediation) {
      line += `\n  remediation: ${report.remediation}`;
    }
    process.stderr.write(`${line}\n`);
  }

  /** Warnings are shown at "normal" or higher, and always go to stderr. */
  warn(message: string, data?: Record<string, unknown>): void {
    if (!this.isEnabled("normal")) {
      return;
    }
    if (this.format === "json") {
      process.stderr.write(`${JSON.stringify({ level: "warn", message, ...data })}\n`);
      return;
    }
    process.stderr.write(`warning: ${message}\n`);
  }
}
