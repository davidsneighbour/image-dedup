import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256File } from "../../src/inventory/exact-hash.js";

describe("sha256File", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "image-origin-hash-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("matches Node's synchronous hash for the same bytes", async () => {
    const content = Buffer.from("the quick brown fox jumps over the lazy dog");
    const path = join(dir, "sample.bin");
    await writeFile(path, content);

    const expected = createHash("sha256").update(content).digest("hex");
    await expect(sha256File(path)).resolves.toBe(expected);
  });

  it("produces identical hashes for identical content at different paths", async () => {
    const content = Buffer.from([1, 2, 3, 4, 5]);
    const pathA = join(dir, "a.bin");
    const pathB = join(dir, "b.bin");
    await writeFile(pathA, content);
    await writeFile(pathB, content);

    const [hashA, hashB] = await Promise.all([sha256File(pathA), sha256File(pathB)]);
    expect(hashA).toBe(hashB);
  });
});
