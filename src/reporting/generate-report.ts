import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { CliError, ExitCode } from "../cli/exit-codes.js";
import type { Logger } from "../cli/output.js";
import { readPackageVersion } from "../cli/package-version.js";
import type { ImageOriginConfig } from "../config/schema.js";
import type { ImageGroup } from "../domain/image-group.js";
import { openDatabase } from "../persistence/database.js";
import { listScanErrors } from "../persistence/repositories/errors.js";
import { listGroupsOfKind } from "../persistence/repositories/groups.js";
import { listImageRecords } from "../persistence/repositories/image-records.js";
import { renderReportHtml } from "./html/render-report.js";
import { type JsonReport, assertValidJsonReport, buildJsonReport } from "./json-report.js";
import { buildReportAssets } from "./report-assets.js";

export interface GenerateReportOptions {
  config: ImageOriginConfig;
  logger: Logger;
  /** PLAN.md §19: image paths are input-relative unless this is set. */
  absolutePaths: boolean;
  pretty: boolean;
}

export interface GenerateReportResult {
  report: JsonReport;
  auditJsonPath: string;
  htmlReportPath: string;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Best-effort: walks up from `startDir` looking for a `.git` directory. Absent if none is found within a reasonable depth. */
async function findRepositoryRoot(startDir: string): Promise<string | undefined> {
  let dir = resolve(startDir);
  for (let depth = 0; depth < 30; depth++) {
    if (await pathExists(join(dir, ".git"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
  return undefined;
}

/**
 * Builds and writes the JSON report (PLAN.md §19), report thumbnails/detail
 * crops, and the static HTML review report (PLAN.md §20) from whatever is
 * currently persisted in the workspace database. Reads only — never
 * re-runs discovery/matching/scoring; run `audit` first to populate or
 * refresh the workspace.
 */
export async function generateReport(
  options: GenerateReportOptions,
): Promise<GenerateReportResult> {
  const { config, logger } = options;

  const databasePath = join(config.workspace, "database.sqlite");
  if (!(await pathExists(databasePath))) {
    throw new CliError(
      `No audit workspace found at "${config.workspace}".`,
      ExitCode.commandFailed,
      "Run `image-origin audit` first to populate the workspace, then re-run `image-origin report`.",
    );
  }

  const db = await openDatabase(config.workspace);
  let records: ReturnType<typeof listImageRecords>;
  let groups: ImageGroup[];
  let errors: ReturnType<typeof listScanErrors>;
  try {
    records = listImageRecords(db);
    groups = [...listGroupsOfKind(db, "exact-duplicate"), ...listGroupsOfKind(db, "visual")];
    errors = listScanErrors(db);
  } finally {
    db.close();
  }

  const reportDir = join(config.workspace, "report");

  logger.info("Generating report assets");
  logger.info(`  ${groups.length} groups, ${records.length} inventoried images`);
  const assetsByRecordId = await buildReportAssets(records, groups, {
    workspace: config.workspace,
    reportDir,
    concurrency: config.concurrency.decoding,
    onError: (record, error) => {
      errors.push({
        phase: "report",
        filePath: record.path,
        operation: "generate report assets",
        error: error instanceof Error ? error.message : String(error),
        continued: true,
      });
      logger.error({
        phase: "report",
        filePath: record.path,
        operation: "generate report assets",
        error: error instanceof Error ? error.message : String(error),
        continued: true,
      });
    },
  });

  const repositoryRoot = await findRepositoryRoot(config.inputs[0] ?? process.cwd());

  const report = buildJsonReport({
    config,
    records,
    groups,
    errors,
    toolVersion: readPackageVersion(),
    absolutePaths: options.absolutePaths,
    ...(repositoryRoot ? { repositoryRoot } : {}),
    assetsByRecordId,
  });

  assertValidJsonReport(report);

  const serialized = options.pretty ? JSON.stringify(report, null, 2) : JSON.stringify(report);

  const auditJsonPath = join(config.workspace, "audit.json");
  await writeFile(auditJsonPath, `${serialized}\n`, "utf8");

  const dataDir = join(reportDir, "data");
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, "report.json"), `${serialized}\n`, "utf8");

  const htmlReportPath = join(reportDir, "index.html");
  await writeFile(htmlReportPath, renderReportHtml(report), "utf8");

  logger.info("Report");
  logger.info(`  JSON report written to ${auditJsonPath}`);
  logger.info(`  HTML report written to ${htmlReportPath}`);

  return { report, auditJsonPath, htmlReportPath };
}
