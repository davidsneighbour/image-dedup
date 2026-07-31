import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Logger } from "../../src/cli/output.js";
import { resolveDefaultConfig } from "../../src/config/defaults.js";
import { runAudit } from "../../src/discovery/run-audit.js";
import { generateReport } from "../../src/reporting/generate-report.js";
import { jsonReportSchema } from "../../src/reporting/json-report.js";
import { type FixtureTree, buildFixtureTree } from "./helpers/build-fixture-tree.js";

function silentLogger(): Logger {
  return new Logger({ level: "quiet" });
}

describe("generateReport", () => {
  let fixture: FixtureTree;

  beforeEach(async () => {
    fixture = await buildFixtureTree();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("writes a schema-valid JSON report and a self-contained HTML report after an audit", async () => {
    const workspace = join(fixture.root, ".image-origin");
    const config = resolveDefaultConfig([fixture.inputDir]);
    config.workspace = workspace;

    const auditResult = await runAudit({ config, logger: silentLogger(), force: false });
    expect(auditResult.exactDuplicateGroups).toBeGreaterThanOrEqual(1);

    const result = await generateReport({
      config,
      logger: silentLogger(),
      absolutePaths: false,
      pretty: true,
    });

    // JSON report.
    expect(result.report.summary.exactDuplicateGroups).toBe(auditResult.exactDuplicateGroups);
    const parsed = jsonReportSchema.safeParse(result.report);
    expect(parsed.success).toBe(true);

    const auditJsonRaw = await readFile(result.auditJsonPath, "utf8");
    expect(JSON.parse(auditJsonRaw)).toEqual(result.report);

    // No absolute paths leaked by default.
    for (const image of result.report.images) {
      expect(image.absolutePath).toBeUndefined();
      expect(image.path.startsWith("/")).toBe(false);
    }

    // Grouped images (the exact-duplicate pair) got report assets; the
    // rest of the fixture's images were never in any group and shouldn't
    // have spent time on thumbnail generation.
    const groupedImageIds = new Set(result.report.groups.flatMap((group) => group.members));
    for (const image of result.report.images) {
      if (groupedImageIds.has(image.id)) {
        expect(image.assets?.thumbnail).toBeDefined();
      } else {
        expect(image.assets).toBeUndefined();
      }
    }

    // HTML report.
    const html = await readFile(result.htmlReportPath, "utf8");
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain('id="report-data"');
    expect(html).toContain("export-decisions");
    // Exactly the two legitimate script tags close with a literal `</script>` —
    // one for the embedded data, one for the client code.
    expect(html.split("</script>").length - 1).toBe(2);
  });

  it("refuses to run against a workspace with no prior audit", async () => {
    const workspace = join(fixture.root, ".image-origin-missing");
    const config = resolveDefaultConfig([fixture.inputDir]);
    config.workspace = workspace;

    await expect(
      generateReport({ config, logger: silentLogger(), absolutePaths: false, pretty: false }),
    ).rejects.toThrow(/audit/i);
  });
});

describe("generateReport: HTML escaping of untrusted filenames", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "image-origin-report-escape-test-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("never lets a maliciously named file break out of the embedded data script tag", async () => {
    // A single filename can never itself contain "/", so the literal
    // sequence "</script>" can only arise across a real path separator —
    // a directory ending in "<" followed by a file starting with
    // "script>", both individually legal POSIX names. This is the
    // realistic version of "treat image files as untrusted input"
    // (PLAN.md §31) for a report that embeds file-derived paths.
    const inputDir = join(root, "input");
    const trickyDir = join(inputDir, "foo<");
    await mkdir(trickyDir, { recursive: true });

    const trickyFile = join(trickyDir, "script>alert(1)<.png");
    await sharp({
      create: { width: 20, height: 20, channels: 3, background: { r: 50, g: 60, b: 70 } },
    })
      .png()
      .toFile(trickyFile);

    const workspace = join(root, ".image-origin");
    const config = resolveDefaultConfig([inputDir]);
    config.workspace = workspace;

    await runAudit({ config, logger: silentLogger(), force: false });

    const result = await generateReport({
      config,
      logger: silentLogger(),
      absolutePaths: false,
      pretty: false,
    });

    expect(result.report.images.some((image) => image.path.includes("</script>"))).toBe(true);

    const html = await readFile(result.htmlReportPath, "utf8");

    // Only the two legitimate, generated script tags close with a literal `</script>`.
    expect(html.split("</script>").length - 1).toBe(2);

    // The path must still round-trip correctly through the escaped data blob.
    const match = html.match(
      /<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/,
    );
    expect(match).not.toBeNull();
    const embedded = JSON.parse(match![1]!) as { images: { path: string }[] };
    expect(embedded.images.some((image) => image.path.includes("</script>"))).toBe(true);
  });
});
