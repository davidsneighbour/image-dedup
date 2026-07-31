import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverFiles } from "../../src/discovery/discover-files.js";
import { type FixtureTree, buildFixtureTree } from "./helpers/build-fixture-tree.js";

describe("discoverFiles", () => {
  let fixture: FixtureTree;

  beforeEach(async () => {
    fixture = await buildFixtureTree();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("discovers supported images by extension, including hidden files and uppercase extensions", async () => {
    const entries = await discoverFiles({
      inputs: [fixture.inputDir],
      include: ["**/*.{jpg,jpeg,png,webp,avif,gif}"],
      exclude: ["**/node_modules/**", "**/.git/**"],
      followSymlinks: true,
      workspace: `${fixture.root}/.image-origin`,
    });

    const byPath = new Map(entries.map((entry) => [entry.path.split("/").pop(), entry]));

    expect(byPath.get("red.jpg")?.status).toBe("discovered");
    expect(byPath.get("blue.png")?.status).toBe("discovered");
    expect(byPath.get("green.webp")?.status).toBe("discovered");
    expect(byPath.get("yellow.gif")?.status).toBe("discovered");
    expect(byPath.get(".hidden.jpg")?.status).toBe("discovered");
    expect(byPath.get("UPPER.JPG")?.status).toBe("discovered");
  });

  it("classifies duplicate paths reached through a symlink", async () => {
    const entries = await discoverFiles({
      inputs: [fixture.inputDir],
      include: ["**/*.{jpg,jpeg,png,webp,avif,gif}"],
      exclude: [],
      followSymlinks: true,
      workspace: `${fixture.root}/.image-origin`,
    });

    const alias = entries.find((entry) => entry.path.endsWith("zzz-red-alias.jpg"));
    expect(alias?.status).toBe("duplicate-path");
  });

  it("detects a self-referential symlink loop without hanging", async () => {
    const entries = await discoverFiles({
      inputs: [fixture.inputDir],
      include: ["**/*.{jpg,jpeg,png,webp,avif,gif}"],
      exclude: [],
      followSymlinks: true,
      workspace: `${fixture.root}/.image-origin`,
    });

    const loop = entries.find((entry) => entry.path.endsWith("loop.jpg"));
    expect(loop?.status).toBe("symlink-skipped");
    expect(loop?.reason).toMatch(/loop/i);
  });

  it("finds extensionless and mislabelled images by content when include is broad", async () => {
    const entries = await discoverFiles({
      inputs: [fixture.inputDir],
      include: ["**/*"],
      exclude: [],
      followSymlinks: true,
      workspace: `${fixture.root}/.image-origin`,
    });

    const noExtension = entries.find((entry) => entry.path.endsWith("no-extension"));
    expect(noExtension?.status).toBe("discovered");
    expect(noExtension?.format).toBe("png");

    const mislabelled = entries.find((entry) => entry.path.endsWith("mislabelled.jpg"));
    expect(mislabelled?.status).toBe("discovered");
    expect(mislabelled?.format).toBe("png");
    expect(mislabelled?.reason).toMatch(/content is png/);

    const notes = entries.find((entry) => entry.path.endsWith("notes.txt"));
    expect(notes?.status).toBe("unsupported");
  });

  it("produces deterministic ordering across repeated runs", async () => {
    const options = {
      inputs: [fixture.inputDir],
      include: ["**/*.{jpg,jpeg,png,webp,avif,gif}"],
      exclude: [],
      followSymlinks: true,
      workspace: `${fixture.root}/.image-origin`,
    };

    const first = await discoverFiles(options);
    const second = await discoverFiles(options);

    expect(first.map((entry) => entry.path)).toEqual(second.map((entry) => entry.path));
  });
});
