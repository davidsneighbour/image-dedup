import { describe, expect, it } from "vitest";
import { buildIgnorePatterns } from "../../src/discovery/ignore-rules.js";

describe("buildIgnorePatterns", () => {
  it("passes through the configured exclude patterns unchanged", () => {
    const patterns = buildIgnorePatterns(
      "/repo/public",
      ["**/node_modules/**"],
      "/repo/other-workspace",
    );
    expect(patterns).toContain("**/node_modules/**");
  });

  it("adds the resolved workspace directory when it sits inside the input directory", () => {
    const patterns = buildIgnorePatterns("/repo/public", [], "/repo/public/.image-origin");
    expect(patterns).toContain(".image-origin/**");
    expect(patterns).toContain(".image-origin");
  });

  it("does not add a workspace exclusion when the workspace is outside the input directory", () => {
    const patterns = buildIgnorePatterns("/repo/public", [], "/repo/.image-origin");
    expect(patterns).toEqual([]);
  });
});
