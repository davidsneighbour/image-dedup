import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveDefaultConfig } from "../../src/config/defaults.js";
import { readResolvedConfig, writeResolvedConfig } from "../../src/config/resolved-config-file.js";

describe("resolved config file", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "image-origin-resolved-config-test-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("round-trips a written config, including a workspace that didn't exist yet", async () => {
    const workspace = join(root, "nested", ".image-origin");
    const config = resolveDefaultConfig(["/some/input"]);
    config.workspace = workspace;

    await writeResolvedConfig(config);
    const read = await readResolvedConfig(workspace);

    expect(read).toEqual(config);
  });

  it("returns undefined when no resolved config was ever written", async () => {
    const read = await readResolvedConfig(join(root, "never-audited"));
    expect(read).toBeUndefined();
  });

  it("returns undefined for a resolved config file that no longer validates against the current schema", async () => {
    const workspace = join(root, ".image-origin");
    await writeFile(
      // resolved-config-file.ts writes to <workspace>/config.resolved.json — replicate that path here without exporting it, to test the file format independently of the write path.
      join(root, "config.resolved.json"),
      JSON.stringify({ notAValidConfig: true }),
      "utf8",
    );

    const read = await readResolvedConfig(root);
    expect(read).toBeUndefined();
  });
});
