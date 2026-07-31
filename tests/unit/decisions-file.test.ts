import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReviewDecision } from "../../src/domain/review-decision.js";
import {
  mergeDecisions,
  readDecisionsFile,
  writeDecisionsFile,
} from "../../src/review/decisions-file.js";

function decision(groupId: string, overrides: Partial<ReviewDecision> = {}): ReviewDecision {
  return {
    groupId,
    action: "defer",
    selectedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("mergeDecisions", () => {
  it("appends genuinely new decisions", () => {
    const existing = [decision("grp_1")];
    const incoming = [decision("grp_2")];

    expect(mergeDecisions(existing, incoming)).toEqual([decision("grp_1"), decision("grp_2")]);
  });

  it("replaces an existing decision for the same group in place, preserving order", () => {
    const existing = [decision("grp_1"), decision("grp_2")];
    const incoming = [decision("grp_1", { action: "not-related", note: "changed my mind" })];

    const merged = mergeDecisions(existing, incoming);

    expect(merged).toEqual([
      decision("grp_1", { action: "not-related", note: "changed my mind" }),
      decision("grp_2"),
    ]);
  });
});

describe("decisions file round-trip", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "image-origin-decisions-file-test-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("round-trips written decisions, creating the workspace directory if needed", async () => {
    const workspace = join(root, "nested", ".image-origin");
    const decisions = [
      decision("grp_1", { action: "approve-recommendation", selectedImageId: "img_a" }),
    ];

    await writeDecisionsFile(workspace, decisions);
    const read = await readDecisionsFile(workspace);

    expect(read).toEqual(decisions);
  });

  it("returns an empty array when no decisions file exists yet", async () => {
    const read = await readDecisionsFile(join(root, "never-imported"));
    expect(read).toEqual([]);
  });

  it("returns an empty array for a decisions file that no longer validates", async () => {
    await writeFile(join(root, "decisions.json"), JSON.stringify({ not: "an array" }), "utf8");
    const read = await readDecisionsFile(root);
    expect(read).toEqual([]);
  });
});
