import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

export interface FixtureTree {
  root: string;
  inputDir: string;
  cleanup: () => Promise<void>;
}

/**
 * Builds a throwaway directory tree covering the M2 discovery/inventory
 * edge cases called out in PLAN.md §7.3: duplicate paths via symlinks,
 * hidden files, uppercase extensions, extensionless image files, incorrect
 * file extensions, and corrupted files.
 */
export async function buildFixtureTree(): Promise<FixtureTree> {
  const root = await mkdtemp(join(tmpdir(), "image-origin-test-"));
  const inputDir = join(root, "input");
  await mkdir(inputDir, { recursive: true });

  const redJpegPath = join(inputDir, "red.jpg");
  await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 200, g: 20, b: 20 } },
  })
    .jpeg()
    .toFile(redJpegPath);

  await sharp({
    create: {
      width: 24,
      height: 24,
      channels: 4,
      background: { r: 10, g: 10, b: 200, alpha: 0.5 },
    },
  })
    .png()
    .toFile(join(inputDir, "blue.png"));

  await sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 20, g: 200, b: 20 } },
  })
    .webp()
    .toFile(join(inputDir, "green.webp"));

  await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 200, b: 20 } },
  })
    .gif()
    .toFile(join(inputDir, "yellow.gif"));

  // Hidden file.
  await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } },
  })
    .jpeg()
    .toFile(join(inputDir, ".hidden.jpg"));

  // Uppercase extension.
  await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 4, g: 5, b: 6 } },
  })
    .jpeg()
    .toFile(join(inputDir, "UPPER.JPG"));

  // Extensionless image file (content sniffing must still find it — requires a broad include pattern).
  await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 7, g: 8, b: 9 } },
  })
    .png()
    .toFile(join(inputDir, "no-extension"));

  // Incorrect extension: PNG bytes behind a .jpg name.
  await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 9, g: 8, b: 7 } },
  })
    .png()
    .toFile(join(inputDir, "mislabelled.jpg"));

  // Corrupted file: valid extension, garbage content.
  await writeFile(
    join(inputDir, "corrupted.jpg"),
    Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]),
  );

  // Unsupported non-image file, image-like extension excluded by default include glob.
  await writeFile(join(inputDir, "notes.txt"), "not an image");

  // Exact duplicate: a real, separate copy of red.jpg's bytes (distinct
  // inode, identical content) under a different directory, for M3's
  // exact-duplicate grouping.
  await mkdir(join(inputDir, "backups", "originals"), { recursive: true });
  await copyFile(redJpegPath, join(inputDir, "backups", "originals", "red-copy.jpg"));

  // Duplicate path via symlink to an already-discovered file. Named to sort
  // after "red.jpg" so discovery's deterministic (alphabetical) processing
  // order makes "red.jpg" the canonical entry and this one the duplicate.
  await symlink(redJpegPath, join(inputDir, "zzz-red-alias.jpg"));

  // Self-referential symlink loop.
  await symlink(join(inputDir, "loop.jpg"), join(inputDir, "loop.jpg"));

  return {
    root,
    inputDir,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
