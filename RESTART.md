# Restart / continuity doc

This file exists so a new session (human or Claude Code) can pick up work on
this project without re-reading the entire conversation history. Update it at
every checkpoint: after finishing a milestone, before a risky step, or
whenever context is about to run out.

## What this project is

Implementation of `PLAN.md` (repo root) — a CLI tool ("image-origin") that
audits directories of historical website image assets, detects duplicate /
derivative relationships between files, ranks candidates for which one is
the true archival original, and (after human review) consolidates the
selected originals into a canonical directory with a provenance manifest.
Read `PLAN.md` in full before making architectural decisions — it is long
and highly prescriptive (config shape, data model, phases, scoring weights,
safety rules). Do not improvise around it without checking it first.

## Where work is tracked

GitHub issues on `davidsneighbour/image-dedup`:

- **#1** — Epic, tracks all milestones, checklist kept in sync with issue state.
- **#2–#13** — One issue per milestone (M1..M12), matching PLAN.md §34.

Label taxonomy on this repo is the user's custom set (NOT github defaults):
`type:*`, `status:*`, `prio:*`, `meta:*`, `resolution:*`. Use `type:enhancement`
for feature work. Use `status:in-progress` / `status:done` etc. to reflect
state. Do **not** recreate `bug`/`enhancement`/`epic`/`milestone` default
labels — they were intentionally replaced by the user's own taxonomy
partway through the first session; if `gh label list` ever shows the
github defaults again, something's wrong — ask before recreating anything.

Workflow per milestone:
1. `gh issue edit <n> --add-label "status:in-progress"` when starting.
2. Implement, per PLAN.md §35 coding rules (small commits, no deletion,
   no network calls, no AI/remote services, explicit `--apply` for
   mutations, etc.) and §34 acceptance criteria for that milestone.
3. Run lint + typecheck + tests + CLI-against-fixtures.
4. Commit.
5. Comment on the milestone issue with what was done / what's left, tick
   the box in the epic (#1) checklist, swap `status:in-progress` →
   `status:done` (or leave in-progress if partially done — be honest).
6. Update this file's "Current state" section below.

## Current state (last updated: 2026-07-31, end of session 1)

**M1 (project foundation) and M2 (discovery + inventory) are implemented,
tested, and committed.** Per PLAN.md §38's explicit instruction, work
stopped here — do not start M3 (perceptual matching / exact duplicates)
without re-reading §38's gate conditions below and confirming them.

### What exists

- Node/TS/Biome/Vitest project scaffolding at repo root (not a subpackage
  — this repo's sole purpose is this tool).
- CLI (`commander`-based) with all six top-level commands
  (`audit`, `report`, `review` [+ `review import`], `consolidate`,
  `references`, `verify`) registered and showing full `--help`. Only
  `audit` has a real implementation; the rest throw a clear
  "not implemented, see issue #N" `CliError` (exit code 1).
- `src/config/` — zod schema mirroring PLAN.md §4 exactly (including the
  `discovery.followSymlinks` option, which PLAN.md's example config
  doesn't show but §7.1 requires — added it under a new `discovery` key).
  Config loading merges file config + CLI overrides, validates, and
  surfaces errors as `ExitCode.invalidConfiguration`.
- `src/discovery/` — `discoverFiles()`: walks configured inputs via
  `fast-glob`, classifies every candidate as `discovered` / `unsupported`
  / `inaccessible` / `duplicate-path` / `symlink-skipped` (see "Known
  quirks" below for why `ignored` isn't populated), sniffs actual format
  from content (not just extension) via magic bytes, handles symlinks
  (including detecting self-referential loops) without hanging.
- `src/inventory/` — `inspectImage()`: streamed SHA-256, sharp-based
  metadata extraction (dimensions, orientation, alpha, ICC/EXIF/IPTC/XMP
  presence), plus a small hand-rolled EXIF/TIFF tag reader
  (`src/inventory/exif.ts`) for Make/Model/DateTime/DateTimeOriginal/
  Copyright/Artist only — not a general EXIF library.
- `src/persistence/` — SQLite (`better-sqlite3`) workspace database with
  linear migrations (`PRAGMA user_version`), `images` + `scan_errors`
  tables, repository functions for upsert/lookup/list.
- `src/discovery/run-audit.ts` — orchestrates discovery → inventory →
  persistence for the `audit` command, with cache-based skip-if-unchanged
  (path+size+mtime) and per-file error recording that never aborts the
  whole scan.
- 39 passing tests (`tests/unit/*`, `tests/integration/*`), covering: format
  sniffing, config validation, EXIF parsing, ignore-pattern building,
  SHA-256 streaming, config file loading/error paths, full discovery
  behavior against a real generated fixture tree (hidden files, uppercase
  extensions, extensionless + mislabelled images via content sniffing,
  symlink duplicate-path, symlink loop), and full `runAudit` behavior
  (inventory + non-fatal corrupted-file error recording + cache reuse +
  resumability-after-simulated-crash).
- `README.md`, `docs/limitations.md`, `image-origin.config.example.mjs`.
- Manually verified: built (`dist/`) CLI runs against a real ad-hoc fixture
  dir end-to-end (`audit` → inspects images → second run reuses cache).

### Known quirks / deliberate simplifications (revisit if they bite)

- **`ignored` discovery status is never emitted.** Files matched by
  `exclude` glob patterns are filtered out inside `fast-glob` itself and
  never become `DiscoveryEntry` objects, so there's nothing to count. If a
  later milestone needs an accurate "ignored N files" figure (PLAN.md
  §29.2's sample output shows one), this needs a second, unfiltered glob
  pass to diff against — deliberately not done yet (perf cost for large
  trees) .
- **Symlinked directories are never traversed** (`fast-glob` called with
  `followSymbolicLinks: false`). This sidesteps symlink-loop risk during
  directory traversal entirely, but means images reachable only through a
  symlinked *directory* won't be discovered. Symlinked *files* directly
  matching the include pattern are still discovered and resolved (this
  required a specific fast-glob incantation — `onlyFiles: false,
  followSymbolicLinks: false, objectMode: true, stats: false`, then
  filtering out directory dirents ourselves — see the comment in
  `discover-files.ts` for why; using `onlyFiles: true` there silently
  drops symlinked files instead of returning them for us to classify).
- **`fast-glob` needs `caseSensitiveMatch: false`** or uppercase extensions
  (`UPPER.JPG`) are silently excluded on Linux.
- **`better-sqlite3` must be `^13.x`**, not the `^11.x` PLAN.md's example
  implies is fine — `11.x` fails to compile against Node 26's V8 headers
  (`PropertyCallbackInfo::This()` was removed upstream). If a future
  environment uses an older Node, re-check whether 13.x still installs
  cleanly there.
- npm on this machine enforces an install-script allowlist
  (`allowScripts` in `package.json`); `better-sqlite3`, `sharp`,
  `@biomejs/biome`, and `esbuild` all need their install/postinstall
  scripts approved (`npm install-scripts approve <pkg>`) or native
  binaries won't build/install.
- `docs/architecture.md`, `docs/scoring.md`, `docs/workflow.md` (listed in
  PLAN.md §33) were deliberately **not** written yet — they'd describe
  systems (matching, scoring, review/consolidation workflow) that don't
  exist yet. Write them as each relevant milestone lands, not speculatively.
- EXIF parsing is intentionally narrow (see above) — extend
  `src/inventory/exif.ts`'s tag list if a later milestone needs more
  fields; it already has the IFD-walking machinery.

## Next steps if resuming

1. `git status` and `git log` to confirm what's actually committed vs. this
   doc's claims (this doc can go stale — trust the repo over the doc).
2. `gh issue list --label type:enhancement` and read open issues — #4 (M3:
   exact duplicates) is next per PLAN.md's ordering, but re-read §38's gate
   first (below).
3. Run `npm run lint && npm run typecheck && npm test && npm run build`
   to confirm the baseline is still green before adding anything.
4. Re-read PLAN.md §9 (exact duplicates) before starting M3.

### Gate before starting M3 (PLAN.md §38, verify all before proceeding)

- [x] discovery is deterministic (tested)
- [x] metadata extraction is tested
- [x] SHA-256 hashing is correct (tested against Node's own hash)
- [x] SQLite persistence is stable (migrations, upsert, read all tested)
- [x] interrupted scans can resume (tested via simulated pre-existing record)
- [x] fixture-based integration tests pass

All boxes above were true as of the end of this session — re-verify by
actually running the test suite, don't just trust this checklist.

## Constraints to keep re-reading (easy to forget)

- No deletion of files in this version, anywhere (PLAN.md §35).
- No network calls, no AI/remote services, no sending image data anywhere.
- Mutations require explicit `--apply`; `--yes` is a separate, non-substitute flag.
- Never treat perceptual hashes as conclusive; never rank by dimensions/size alone.
- Confidence and quality score are separate concepts — do not conflate.
- Prefer `manual-review` over a confident-but-unsupported guess.
