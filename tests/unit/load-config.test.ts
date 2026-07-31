import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CliError, ExitCode } from "../../src/cli/exit-codes.js";
import { loadConfig } from "../../src/config/load-config.js";

describe("loadConfig", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "image-origin-config-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loads and validates a config file's default export", async () => {
    const configPath = join(dir, "image-origin.config.mjs");
    await writeFile(configPath, `export default { inputs: ["./public"] };\n`);

    const config = await loadConfig({ configPath });
    expect(config.inputs).toEqual(["./public"]);
    expect(config.workspace).toBe("./.image-origin");
  });

  it("applies CLI overrides on top of the file config", async () => {
    const configPath = join(dir, "image-origin.config.mjs");
    await writeFile(configPath, `export default { inputs: ["./public"] };\n`);

    const config = await loadConfig({ configPath, overrides: { inputs: ["./from-cli"] } });
    expect(config.inputs).toEqual(["./from-cli"]);
  });

  it("resolves defaults with no config file when overrides alone are valid", async () => {
    const config = await loadConfig({ overrides: { inputs: ["./public"] } });
    expect(config.inputs).toEqual(["./public"]);
  });

  it("throws a CliError with invalidConfiguration for a missing input directory list", async () => {
    await expect(loadConfig({ overrides: {} })).rejects.toMatchObject({
      exitCode: ExitCode.invalidConfiguration,
    });
  });

  it("throws a CliError when the config file has no default export", async () => {
    const configPath = join(dir, "bad.mjs");
    await writeFile(configPath, "export const notDefault = {};\n");

    const error = await loadConfig({ configPath }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).exitCode).toBe(ExitCode.invalidConfiguration);
  });

  it("throws a CliError when the config file fails to parse", async () => {
    const configPath = join(dir, "syntax-error.mjs");
    await writeFile(configPath, "export default {{{ not valid javascript");

    await expect(loadConfig({ configPath })).rejects.toBeInstanceOf(CliError);
  });
});
