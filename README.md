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

Early development. Implemented so far: `audit`'s discovery and inventory
phases (file discovery, format detection, metadata extraction, SHA-256
hashing, SQLite-backed caching and resumable scans). Duplicate/derivative
detection, scoring, reporting, review, consolidation, and reference
migration are not implemented yet — see the milestone issues on this
repository for progress.

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
| `audit` | discovery + inventory implemented | Scan inputs, fingerprint images |
| `report` | not implemented | Generate JSON/HTML reports |
| `review` | not implemented | Review groups, import decisions |
| `consolidate` | not implemented | Copy approved originals to canonical dir |
| `references` | not implemented | Find/replace source-code image references |
| `verify` | not implemented | Verify consolidation, references, repo checks |

Every command supports `--help`.

## Safety model

- Mutating commands (`consolidate`, `references --apply`) require an
  explicit `--apply` flag; `--yes` only suppresses interactive
  confirmation and never substitutes for `--apply`.
- Nothing is deleted in this version of the tool, anywhere, under any flag.
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
