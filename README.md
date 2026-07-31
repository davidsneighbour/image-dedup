# image-origin

Audits directories of historical website image assets, detects which files
represent the same underlying image, ranks candidates for which one is the
true archival original, and — after human review — consolidates the
selected originals into a canonical directory with a provenance manifest.

> Originals are curated inputs. Responsive images, thumbnails, format
> conversions, and optimised variants are generated outputs.

Full specification: [`PLAN.md`](./PLAN.md). Implementation status and
restart notes: [`RESTART.md`](./RESTART.md).

## Status

Early development. Progress against [`PLAN.md` §34](./PLAN.md#34-implementation-order):

- [x] [Milestone 1: project foundation](https://github.com/davidsneighbour/image-dedup/issues/2)
- [x] [Milestone 2: discovery and inventory](https://github.com/davidsneighbour/image-dedup/issues/3)
- [x] [Milestone 3: exact duplicates](https://github.com/davidsneighbour/image-dedup/issues/4)
- [x] [Milestone 4: perceptual matching](https://github.com/davidsneighbour/image-dedup/issues/5)
- [x] [Milestone 5: confirmation and relationship classification](https://github.com/davidsneighbour/image-dedup/issues/6)
- [x] [Milestone 6: crop and upscale detection](https://github.com/davidsneighbour/image-dedup/issues/7)
- [x] [Milestone 7: scoring and recommendations](https://github.com/davidsneighbour/image-dedup/issues/8)
- [x] [Milestone 8: reports](https://github.com/davidsneighbour/image-dedup/issues/9)
- [x] [Milestone 9: review import](https://github.com/davidsneighbour/image-dedup/issues/10)
- [x] [Milestone 10: consolidation](https://github.com/davidsneighbour/image-dedup/issues/11)
- [ ] [Milestone 11: reference discovery](https://github.com/davidsneighbour/image-dedup/issues/12)
- [ ] [Milestone 12: reference replacement and verification](https://github.com/davidsneighbour/image-dedup/issues/13)

See [issue #1](https://github.com/davidsneighbour/image-dedup/issues/1) for
the tracking epic and milestone-by-milestone discussion.

## Installation

Requires Node.js 24+.

```bash
npm install
npm run build
```

During development, run commands directly against source with `tsx`:

```bash
npm run dev -- audit --input ./photos --workspace ./.image-origin
```

## Quick start

```bash
image-origin audit \
  --input ./public \
  --input ./backups \
  --workspace ./.image-origin
```

This scans the given input directories, extracts metadata and a SHA-256
hash for every supported image, and caches results in
`<workspace>/database.sqlite`. Re-running the same command skips files
whose path, size, and modification time are unchanged; pass `--force` to
recompute everything.

See [`image-origin.config.example.mjs`](./image-origin.config.example.mjs)
for the full configuration shape, or pass `--config <path>` to use your
own. Every option has a conservative default (PLAN.md §4) — nothing in the
config file alone can trigger a mutating operation.

## Commands

| Command | Status | Purpose |
| --- | --- | --- |
| `audit` | implemented | Scan inputs, fingerprint images, detect duplicates/derivatives, score candidates |
| `report` | implemented | Generate JSON/HTML reports |
| `review import` | implemented | Import human decisions exported from the HTML report |
| `consolidate` | implemented | Copy approved originals to the canonical originals directory |
| `rollback` | implemented | Undo files copied by a previous `consolidate --apply` run |
| `references` | not implemented | Find/replace source-code image references |
| `verify` | not implemented | Verify consolidation, references, repo checks |

Every command supports `--help`.

## Safety model

- Mutating commands (`consolidate`, `rollback`, `references --apply`) require
  an explicit `--apply` flag; `--yes` only suppresses interactive
  confirmation and never substitutes for `--apply`.
- Source files are never deleted or modified by any command, under any flag.
  `rollback` only ever removes files `consolidate` itself created in the
  canonical originals directory, and only after re-verifying their content
  hash still matches what was written and that no later run still depends
  on them.
- No network calls, no AI/remote services, no image data leaves the
  machine.
- The tool never writes outside the configured workspace or originals
  directory.
- Copies are verified by comparing source and destination SHA-256 after
  every file operation.

## Supported formats

JPEG, PNG, WebP, AVIF (where supported by the installed `sharp`/libvips
build), and GIF (metadata inspection). Format is detected from file
content, not just extension — a mislabelled or extensionless file is still
recognised if its content matches a supported format.

## Known limitations

See [`PLAN.md` §1.2](./PLAN.md#12-out-of-scope-for-the-initial-implementation)
for what this tool intentionally does not attempt (facial/object
recognition, copyright determination, automatic deletion, destructive EXIF
rewriting, video, SVG comparison, etc.).

Current implementation-specific limitations (will narrow as milestones
land — see `RESTART.md`):

- EXIF field extraction covers Make, Model, DateTime/DateTimeOriginal,
  Copyright, and Artist only; other EXIF tags are not parsed.
- Discovery does not separately count files skipped by `exclude` patterns
  (they're simply never enumerated), so the "ignored" discovery status is
  not currently populated.
- Symlinked directories are not traversed (avoids symlink-loop risk at the
  directory-walk level); symlinked files are still discovered and resolved
  individually.
- Date-based canonical paths (`consolidation.naming: "date-slug"`/
  `"template"`) use the trusted EXIF capture date when present, falling
  back to filesystem modification time (flagged as weak) or
  `unknown-date`; PLAN.md's "configured source date" tier has no
  corresponding config field yet.
- `rollback` doesn't rewrite `<originalsDirectory>/manifest.json` after
  removing files — the manifest reflects the run that wrote it, not
  necessarily the current directory contents. Re-run `consolidate --apply`
  after a rollback to regenerate it.
