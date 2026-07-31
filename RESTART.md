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

## Current state (last updated: 2026-07-31, end of session 1, continued through M4)

**M1 (project foundation), M2 (discovery + inventory), M3 (exact
duplicates), and M4 (perceptual matching) are implemented, tested, and
committed** (commits `e329acb`, `6375433`, `b3b50a8`, `e8a1b3f`). Next per
PLAN.md's ordering: M5 (confirmation and relationship classification,
issue #6) — re-read PLAN.md §11 and §15 before starting it.

### M4 — what was added on top of M1/M2/M3

- `src/matching/perceptual-hash.ts` — `computeDifferenceHash` (dHash: 9x8
  greyscale grid, horizontal-gradient bits) and `computePerceptualHash`
  (pHash: 32x32 greyscale → 2D DCT-II via a precomputed cosine basis
  matrix → top-left 8x8 low-frequency block, thresholded against its own
  median). Both return 16-hex-char (64-bit) hashes. `hammingDistanceHex`
  compares two such hashes via nibble-XOR popcount.
  - **Important gotcha if touching this code**: a plain smooth gradient is
    a pathological test image for DCT-based pHash — it concentrates
    nearly all DCT energy into ~7 coefficients, leaving the rest of the
    8x8 block near-zero, so the median sits near zero and unrelated noise
    (resize interpolation, JPEG quantization) flips ~20-30% of bits
    essentially at random. This isn't a bug; real photographs have
    texture across many frequencies and don't hit this. Test fixtures use
    a synthetic multi-frequency sine/cosine pattern (see
    `texturedBuffer()`/`richTextureBuffer()` in the test files) instead of
    a gradient, specifically because of this. If you see mysteriously
    large Hamming distances between a source and its resize/format
    conversion in a new test, suspect the test image's texture first.
- `src/matching/bk-tree.ts` — generic `BKTree<T>` keyed by a caller-supplied
  distance function. Items at distance 0 from an existing node share that
  node's `items[]` list rather than becoming a child (correct, since
  Hamming distance is a proper metric: two items with distance 0 between
  them are equidistant from any third point) — this also avoids silently
  dropping hash-collision items, which a naive "one item per node, skip on
  d===0" implementation would do.
- `src/matching/candidate-index.ts` — `generateCandidatePairs()`: buckets
  records by aspect ratio (bucket width = `4 * aspectRatioTolerance`,
  neighbouring buckets included per query so boundary cases aren't
  missed), builds one BK-tree per bucket pool, queries each record against
  it. A pair is only kept if dHash distance, pHash distance, AND the
  precise aspect-ratio delta all clear their configured thresholds.
  Excludes pairs that are already exact duplicates (same SHA-256).
- `src/matching/hash-images.ts` — `computeMissingHashes()`: skips records
  that already have both hashes (same across-run caching philosophy as
  everything else), and deduplicates by SHA-256 before decoding — only one
  representative per distinct content hash is actually decoded, the rest
  copy its result.
- `src/domain/candidate-pair.ts` — `PerceptualCandidatePair`. Deliberately
  *not* an `ImageGroup`: a hash match is a candidate signal only (§10.2),
  not confirmation. Confirmation (SSIM etc.) and turning candidates into
  actual `ImageGroup`s with a relationship/confidence is M5's job — don't
  short-circuit that by upgrading candidate pairs to groups prematurely.
- New `candidate_pairs` SQLite table (migration v3), same
  recompute-and-replace-wholesale pattern as `groups`.
- Fixed a gap from M3: exact-duplicate matching had been running
  unconditionally; it and perceptual matching are now both gated on
  `config.matching.exactHash`/`config.matching.perceptualHash`.
- `runAudit()`'s "Matching" log section now also reports hashes
  computed/reused and candidate pair count, labelled "(pending
  confirmation)" to avoid implying these are final relationships.

### Previous state (M1 + M2 + M3), for reference — still accurate

### M3 — what was added on top of M1/M2

- `src/domain/relationship.ts` — `ImageRelationship` union (§5.2). Only
  `"exact-duplicate"` is actually produced so far; the rest of the union
  exists now so the type doesn't change shape as M4-M6 add their detectors.
- `src/domain/image-group.ts` — `ImageGroup`/`ImageComparison` interfaces
  (§5.3) plus a zod `imageGroupSchema` used to validate every group before
  it's persisted. Added a `kind: "exact-duplicate"` discriminator not
  present in PLAN.md's interface verbatim — needed because different
  detectors (exact hash now, perceptual from M4) produce groups that must
  be recomputed/replaced independently; §19's report summary already
  implies this by tracking `exactDuplicateGroups` and `visualGroups`
  separately.
- `src/matching/exact-duplicates.ts` — `computeExactDuplicateGroups()`.
  Pure function, no I/O: buckets records by `file.sha256`, produces a
  deterministic `grp_<sha256 prefix>` id per bucket (content-derived, so
  re-running never changes an unchanged group's id), computes storage
  waste, detects hard links (same `file.device`+`file.inode`), and only
  sets `recommendedOriginalId`/`status: "automatic"` when a configured
  `pathPreferences` entry makes the choice unambiguous — otherwise
  `status: "manual-review"`. There is deliberately no quality-based
  ranking here: members are byte-identical, so nothing to rank by (that
  starts at M7, for non-identical derivatives).
- `src/matching/path-preferences.ts` — `scorePathPreference()`, glob
  matching via `picomatch` (added as a new dependency) against
  `relativePath`.
- `src/persistence/repositories/groups.ts` + migration v2 (`groups`
  table). Groups are treated as fully derived data: every audit run
  recomputes exact-duplicate groups from *all* currently-inventoried
  records (via `listImageRecords`, not just this run's newly-scanned
  ones) and replaces the whole `exact-duplicate`-kind set in one
  transaction. This means a duplicate pair split across two separate scans
  (file A scanned today, identical file B added next week) is still
  caught on the next run — there's no incremental-group-patching logic to
  get subtly wrong.
- `ImageRecord.file` gained `inode`/`device` (populated from `fs.stat()`
  in `inspect-image.ts`) — needed for hard-link detection, nothing else
  currently reads them.
- `runAudit()` now has a third phase after Discovery/Inventory: "Matching"
  — logs exact-duplicate group count and recoverable MB, returns
  `exactDuplicateGroups`/`wastedBytes` on the result.
- Dependency bump: `sharp` `^0.33.5` → `0.35.3` and `vitest` `^2.1.1` →
  `4.1.10`, to clear known CVEs (sharp inherited libvips CVEs — directly
  relevant given PLAN.md §31's "treat image files as untrusted input"
  requirement; vitest's dev-dependency chain had a critical "Vitest UI
  server can read arbitrary files" advisory). `npm audit` and GitHub
  Dependabot are both clean as of this commit — re-run `npm audit` if
  resuming much later, advisories accumulate over time.

### Previous state (M1 + M2), for reference — still accurate

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
2. `gh issue list --label type:enhancement` and read open issues — #6 (M5:
   confirmation and relationship classification) is next per PLAN.md's
   ordering.
3. Run `npm run lint && npm run typecheck && npm test && npm run build`
   (and maybe `npm audit`) to confirm the baseline is still green before
   adding anything.
4. Re-read PLAN.md §11 (visual confirmation: SSIM, alpha comparison,
   rotation/mirroring) and §15 (relationship classification rules) before
   starting M5. Note M5 needs an SSIM implementation (PLAN.md §3.1 lists
   this as a dependency to add — none chosen yet) and turns M4's
   unconfirmed `candidate_pairs` into classified `ImageGroup`s with an
   `ImageRelationship` (resize/format-conversion/recompression/crop/etc.)
   — this is also where per PLAN.md §16, pairwise relationships get
   converted into actual groups (connected-components-ish, but cautious
   about weak-chain over-merging: "A resembles B, B resembles C" must not
   force "A resembles C").

### Gate that was cleared before starting M3 (PLAN.md §38) — for reference

- [x] discovery is deterministic (tested)
- [x] metadata extraction is tested
- [x] SHA-256 hashing is correct (tested against Node's own hash)
- [x] SQLite persistence is stable (migrations, upsert, read all tested)
- [x] interrupted scans can resume (tested via simulated pre-existing record)
- [x] fixture-based integration tests pass

PLAN.md doesn't specify an equivalent explicit gate before M4, but the
same spirit applies: M3 (exact duplicates) is tested and stable as of this
commit — re-verify by actually running the test suite, don't just trust
this checklist.

## Constraints to keep re-reading (easy to forget)

- No deletion of files in this version, anywhere (PLAN.md §35).
- No network calls, no AI/remote services, no sending image data anywhere.
- Mutations require explicit `--apply`; `--yes` is a separate, non-substitute flag.
- Never treat perceptual hashes as conclusive; never rank by dimensions/size alone.
- Confidence and quality score are separate concepts — do not conflate.
- Prefer `manual-review` over a confident-but-unsupported guess.
