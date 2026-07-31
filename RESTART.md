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

## Current state (last updated: 2026-07-31, end of session 1, continued through M7)

**M1-M7 are implemented, tested, and committed** (commits `e329acb`,
`6375433`, `b3b50a8`, `e8a1b3f`, `e3580de`, `842cf38`, `79b0751`). Next per
PLAN.md's ordering: M8 (reports, JSON + HTML, issue #9) — re-read PLAN.md
§19 before starting it.

### M7 — what was added on top of M1-M6

- `src/scoring/score-candidate.ts` — the core of PLAN.md §17. `MemberSignals`
  is the per-record input (detail score, pixel count, bit depth, alpha,
  ICC, metadata count, path preference score, crop/upscale flags) —
  `gatherMemberSignals()` derives it from an `ImageRecord` plus the group
  it's in (crop details come from `group.comparisons`, not from the record
  itself). `buildScoringContext()` computes group-wide maxima and
  "does a better alternative exist" flags once per group, so
  `scoreCandidate()` itself is a pure, cheap, directly-testable function —
  no I/O, easy to hit with synthetic signals. Score components (native
  detail, effective resolution, completeness, bit depth, alpha, ICC,
  metadata, path preference) are weighted and summed; disqualifiers
  (crop/upscale/missing-alpha, each only when a genuinely better
  alternative exists in the same group) can zero out a candidate entirely
  regardless of its raw score — PLAN.md §17.1/§18.2 is explicit that even
  high confidence must not bypass these.
- `src/scoring/confidence.ts` — `computeRecommendationConfidence()`. Starts
  from the group's own relationship confidence (M5), then adjusts for
  top-vs-second-place score margin, presence of a crop, and presence of an
  alpha mismatch — deliberately separate from the 0-100 quality score
  (PLAN.md §18: "confidence and quality score are separate concepts").
- `src/scoring/explain-score.ts` — `explainRecommendation()`: turns the
  winning candidate's `reasons`/score and every disqualified candidate's
  `disqualifiedReasons` into the group-level `reasons`/`warnings` a human
  reviewer actually reads.
- `src/scoring/recommend-group-originals.ts` — `recommendGroupOriginal()`,
  the orchestration entry point. Only touches `kind: "visual"` groups
  (exact-duplicate groups already got their recommendation from M3's path
  preference alone — no quality to rank when content is byte-identical).
  Three-way status split by confidence against
  `review.manualReviewThreshold`/`review.automaticConfidenceThreshold`:
  below manual-review threshold → `"ambiguous"`; above automatic threshold
  *and* a non-disqualified candidate exists → `"automatic"` (only case that
  sets `recommendedOriginalId`/`score`); otherwise → `"manual-review"`,
  which still surfaces the top candidate in `reasons` as a suggestion
  without locking it in — mirrors M3's precedent that only `"automatic"`
  ever gets a locked-in recommendation.
- `ImageGroup` gained an optional `score` field (0-100, only present on a
  `"visual"` group when `recommendedOriginalId` is set — exact-duplicate
  groups never get one, enforced by `imageGroupSchema`'s `superRefine`).
- New `config.scoring` section (`src/config/schema.ts`): `weights` (8
  components, must sum to 100, validated) and `penalties` (4 penalty
  amounts). A code comment documents that PLAN.md §17.2's "compression
  quality" and "colour fidelity" components have **no implemented signal**
  yet (that's unassigned future work, not this milestone) — their points
  were redistributed across the components that do exist.
- `src/discovery/run-audit.ts`: after `buildVisualGroups`, every group is
  scored via `recommendGroupOriginal()` and the result replaces the
  `"visual"`-kind group set. New `automaticRecommendations` count in
  `RunAuditResult` and the CLI summary output.

**Two real bugs found via manual CLI testing against the built `dist/`,
neither caught by unit tests** (both now have regression tests):

1. **`detectCrop` direction-reversal** (`src/analysis/crop-detection.ts`):
   its "try both directions, keep whichever scores higher" logic had no
   constraint that the "full" (larger) candidate actually has more pixels
   than the "crop" candidate. A plain downscale (no real crop at all) could
   get classified backwards — the smaller thumbnail treated as "containing"
   the original as a 94%-retained crop of itself. Fixed by filtering
   candidate directions to require `fullPixels >= cropPixels`. Regression
   test: `tests/unit/crop-detection.test.ts` — `"never reports the smaller
   image as the 'larger' (full-frame) side of a crop"`.
2. **Stale `recordsById` during scoring** (`src/discovery/run-audit.ts`) —
   the more serious one. `recordsById` was built from `hashedRecords`
   *before* `detectCropsAndUpscales` ran, and never updated with its
   `updatedRecords` (the records whose `quality.probableUpscale` just got
   set). Scoring reads signals via that same `recordsById` map, so it was
   silently always seeing each record's **pre-detection** quality flags —
   the `probableUpscale` disqualifier in `scoreCandidate` could never
   fire in the real pipeline, even though the flag was correctly persisted
   to the database. A record flagged `probableUpscale: true` in the DB
   could still win a group's recommendation. Manual CLI testing caught
   this because the *displayed* recommendation contradicted the *stored*
   quality flags on inspection; no unit or integration test exercised the
   full `runAudit()` pipeline closely enough to catch it (the two
   integration tests that did call `recommendGroupOriginal` did so
   directly with a hand-built `ImageGroup`, bypassing this exact
   interaction). Fixed by updating `recordsById` alongside the DB upsert
   in the `updatedRecords` loop. Regression test added in
   `tests/integration/crop-upscale-audit.test.ts` (extends the existing
   "flags a naive upscale" test to also assert the *group recommendation*
   correctly excludes the flagged record) — verified it fails without the
   fix (`recommendedOriginalId` stayed `undefined`) and passes with it.
   **If you add any other quality signal that mutates records mid-pipeline
   in `run-audit.ts`, check whether it needs the same `recordsById.set()`
   treatment** — this class of bug (a downstream stage reading a map built
   before an upstream mutation) is easy to reintroduce.

- Also updated a stale M5-era assertion in
  `tests/integration/confirmation-audit.test.ts` that predated M7's wiring
  (`"M5 never recommends an original — that needs M7's scoring"`). That
  fixture reuses the smooth low-frequency `texturedBuffer()` (chosen for
  hash/SSIM stability), which has no genuine fine detail beyond what a
  140px downscale can reconstruct — every full-size derivative in that
  fixture spuriously trips the `probableUpscale` check against the resized
  member, so *which* member ends up recommended is an artifact of
  candidate-graph shape, not a meaningful scoring outcome. Loosened the
  assertion to just check a recommendation was made and it isn't the
  unrelated image, and pointed at `tests/integration/scoring-audit.test.ts`
  (uses a properly-detailed texture) for the real "does scoring pick the
  right candidate" coverage. **If you need another fixture that exercises
  both SSIM confirmation *and* upscale detection meaningfully, neither
  the plain smooth texture nor raw per-pixel noise works** — smooth
  textures have no genuine detail to lose (upscale detection can't
  discriminate), and raw per-pixel noise decorrelates too much under
  resize for SSIM confirmation to pass at all (routes into crop detection
  instead). A smooth low-frequency base with a *blurred* (not raw) noise
  overlay gets closer but still isn't fully reliable — this was explored
  during M7 manual verification and abandoned as a rabbit hole; the
  existing per-purpose fixtures (separate textures for hash tests, crop
  tests, and upscale tests) remain the pragmatic answer.

### M6 — what was added on top of M1-M5

- `src/analysis/crop-detection.ts` — `detectCrop()`. Two-stage, and both
  stages matter (testing found real bugs in each, see below):
  1. **Coarse search**: downscales both images to a 32x32 greyscale grid
     (same idea as pHash), then does a coarse-to-fine sliding-window
     Pearson-correlation search for the best-matching axis-aligned
     subregion (step 2, then a step-1 refinement pass around the coarse
     best). The refinement pass is not optional: a plain step-2 search
     only ever visits even-valued widths/positions, so a true-best box
     needing e.g. an odd width is simply never evaluated — this
     genuinely caused a real crop fixture to go undetected until fixed.
  2. **Real-pixel SSIM verification**: extracts the *actual* pixel region
     the coarse search proposed from the full-resolution source and
     compares it via real SSIM against the crop candidate, with a small
     local pixel-space refinement (the coarse grid's own quantization —
     one grid cell can be 10+ real pixels — can misalign fine detail
     enough to tank SSIM even when the coarse correlation looked good).
     **This stage exists because of a real false-positive bug**: the
     coarse correlation search alone is a "look-elsewhere" problem —
     across hundreds of candidate boxes, images that only share similar
     smooth low-frequency structure occasionally correlated above the
     confidence threshold on *some* subregion purely by chance, even
     between genuinely unrelated images. Caught by testing with properly
     unrelated (differently-seeded) synthetic fixtures — an earlier
     manual check that reused identical noise across "unrelated" fixtures
     masked this initially. If you touch this file, re-verify false
     positives are still suppressed with genuinely independent test
     images, not images sharing a noise seed/generator.
  - `MIN_CONFIDENCE` (coarse) and `SSIM_VERIFICATION_THRESHOLD` (precise)
    are both local constants, not config — revisit if false
    positives/negatives show up on real data.
- `src/matching/crop-candidates.ts` — `generateCropCandidatePairs()`.
  **Necessary because of another real gap**: M4/M5's standard candidate
  threshold (`matching.perceptualDistanceThreshold`, default 10) is tuned
  for "same framing" relationships (resize/recompression/format
  conversion) and is nowhere near permissive enough for a genuine crop to
  ever become a candidate pair — cropping removes real content, which is
  a much bigger perceptual hash change than those relationships produce.
  Without this, crop detection had *nothing to examine* in realistic
  scenarios; it wasn't just under-sensitive, it never ran at all. This
  runs a wider (`CROP_CANDIDATE_DISTANCE_THRESHOLD = 28`), dHash-only,
  **non**-aspect-ratio-bucketed BK-tree search (crops routinely change
  aspect ratio, so M4's bucketing would defeat the purpose) to produce
  extra placeholder pairs fed into crop detection alongside M5's
  already-unconfirmed ones.
  - **Known, deliberate, still-unfixed limitation**: this search is
    still not fully aspect-ratio-independent in spirit — it's a single
    flat BK-tree so aspect ratio doesn't gate it directly, but a crop
    whose dHash ends up more than 28/64 bits different from its source
    (very aggressive crops, or crops combined with heavy recompression)
    will still be missed. Widening the threshold further trades more
    false-candidate load (cost: more crop-detection SSIM work per audit)
    against catching more real crops — no config knob for this yet.
- `src/analysis/upscale-detection.ts` — `detectProbableUpscale()`. Laplacian
  convolution (`sharp().convolve()`) + stdev as a detail/sharpness score,
  compared between the larger image and the smaller candidate naively
  upscaled to the same analysis resolution (capped at 512px). Both scores
  computed at *matched* resolution — comparing raw detail scores at
  different resolutions would be meaningless.
  - **Test fixtures needed real per-pixel noise, not the smooth
    multi-frequency texture used everywhere else in this codebase's
    tests.** A smooth function of normalized position looks identical at
    any resolution (nothing genuine is lost by downscaling then
    upscaling it), so it can't distinguish "genuine extra detail" from
    "naive upscale" at all — see `detailedTexturedBuffer()` in the test
    files for the noise-based alternative, and use it (with a distinct
    seed per image) for any new test involving this detector.
- `src/matching/detect-crops-and-upscales.ts` — orchestrates both:
  crop detection runs over every `"unknown"` comparison (M5's plus the
  wider crop-only candidates above); upscale detection runs over every
  *confirmed* comparison where one image has meaningfully more pixels
  (`MIN_AREA_RATIO_FOR_UPSCALE_CHECK = 1.2`) than the other. Sets
  `ImageRecord.quality.probableUpscale`/`detailScore` on the larger
  image and adds a warning; never deletes, rejects, or auto-merges
  anything — actual scoring/ranking against these signals is M7's job.
- `src/matching/similarity.ts`'s `compareAtScale`/`compareMultiScale` now
  accept `string | Buffer` (not just file paths) for their image inputs —
  needed so crop detection can SSIM-verify an in-memory `sharp().extract()`
  buffer without writing a temp file.
- `ConfirmedComparison` gained an optional `details` bag (mirrors
  `ImageComparison.details` in the domain model) so a crop's
  `cropBox`/`retainedArea`/`largerImageId`/`croppedImageId` can travel
  from detection through to the persisted `comparisons` row and into any
  group's comparison list. New `comparisons.details_json` column
  (migration v5).

### Previous state (M1-M5), for reference — still accurate

### M5 — what was added on top of M1-M4

- `src/matching/similarity.ts` — `compareAtScale`/`compareMultiScale`
  (SSIM via the new `ssim.js` dependency). Both images get resized to the
  same NxN square (`fit: "fill"`) before comparison — deliberate
  simplification, safe because pairs reaching this point already passed
  M4's aspect-ratio tolerance. Multi-scale: 256px first, refined at up to
  1024px (capped by real resolution) only if the 256px score is
  "plausible" (`plausibleMargin`, default 0.5) — avoids wasted work on
  clear non-matches.
  - **`ssim.js` import gotcha**: it's a CJS package with `export default
    ssim` in its `.d.ts`, but under this repo's `NodeNext` +
    `verbatimModuleSyntax` config, `import ssim from "ssim.js"` resolves
    to the whole module namespace (not the function) and fails with "not
    callable". Fixed by `import * as ssimModule from "ssim.js"; const
    ssim = ssimModule.ssim;` (the named export) instead. If a future
    dependency has the same `export =` + `export default` CJS shape, same
    fix applies. Same session also hit an analogous issue with `sharp`'s
    `Sharp` type — `sharp.Sharp` (namespace access via the default import)
    doesn't resolve under this config; use `import sharp, { type Sharp }
    from "sharp"` instead.
  - **`sharp(...).rotate()` with no argument auto-orients from EXIF**
    before any further transform — used deliberately so a rotate180/flip
    test isn't confused by a source file that's already EXIF-rotated.
- `src/analysis/alpha-comparison.ts`, `src/analysis/colour-comparison.ts`
  — cheap signals (sharp `.stats()`, no pixel-level comparison) feeding
  the classifier.
- `src/analysis/relationship-classifier.ts` — pure function, the actual
  §15 rule table. Crop and watermark relationships are NOT produced here
  (crop needs M6's subregion matching; watermark is optional/conservative
  per the plan) — pairs that might be either just end up "unknown" if
  SSIM doesn't confirm them, or get misclassified as e.g. "resize" if SSIM
  happens to be high anyway (a genuine limitation until M6 adds a real
  crop detector — a crop with high remaining-content overlap could still
  pass SSIM and get called a plain "resize").
- `src/matching/confirm-candidates.ts` — orchestrates SSIM + rotation/
  mirror fallback + alpha + colour + classification per M4 candidate
  pair. The rotation/mirror fallback (§11.3) only triggers for pairs
  already in the candidate list whose plain-orientation SSIM didn't
  confirm — not a blanket search.
- **Real bug found and fixed via testing, not by inspection**: a
  180°-rotated test fixture never showed up as confirmable at all. Root
  cause: dHash/pHash are not rotation/mirror-invariant, so M4's candidate
  generation (which only ever hashed the normal orientation) never
  produced original↔rotated as a candidate pair in the first place —
  confirmation only revisits *existing* candidates, so the rotation
  fallback never got a chance to run. Fixed by adding
  `src/matching/orientation-hashes.ts` (`computeOrientationVariants`,
  computes dHash/pHash for rotate180/flipHorizontal/flipVertical per
  distinct SHA-256, **not persisted** — recomputed each run when
  `config.matching.detectRotation` is true) and extending
  `generateCandidatePairs` (`src/matching/candidate-index.ts`) to also
  search the BK-tree using each record's orientation-variant hashes, not
  just its normal one. `src/matching/orientation-transform.ts` now holds
  the shared `OrientationTransform` type + `applyTransform` helper, used
  by both `similarity.ts` and `perceptual-hash.ts` (which gained an
  optional `transform` parameter on `computeDifferenceHash`/
  `computePerceptualHash`).
- `src/matching/build-visual-groups.ts` — confirmed pairwise
  relationships → `ImageGroup`s (kind `"visual"`, added to
  `ImageGroupKind`). Conservative "representative-validated clique"
  construction: within each connected component of confirmed edges, only
  the lexicographically-first member (representative) and nodes with a
  *direct* confirmed edge to it are accepted; everything else in the
  component is left out and surfaced via a group warning, **not**
  reprocessed as its own group in the same pass (a node excluded from one
  group this run just doesn't appear in any group this run — see the
  long comment in that file for why recovering it is riskier than it
  sounds). Group `status` is capped at `"manual-review"`/`"ambiguous"`
  and `recommendedOriginalId` is never set — M5 answers "are these related
  and how", not "which one is the original" (that's M7).
- New `comparisons` SQLite table (migration v4) — every classified pair,
  confirmed or not, persisted for transparency. `groups.kind` now accepts
  `"visual"` alongside M3's `"exact-duplicate"` (widened
  `ImageGroupKind`/`imageGroupSchema`).
- `runAudit()`'s "Matching" log section now also reports confirmed vs.
  unconfirmed pair counts and probable-derivative-group count.

### Previous state (M1 + M2 + M3 + M4), for reference — still accurate

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
2. `gh issue list --label type:enhancement` and read open issues — #9 (M8:
   reports, JSON + HTML) is next per PLAN.md's ordering.
3. Run `npm run lint && npm run typecheck && npm test && npm run build`
   (and maybe `npm audit`) to confirm the baseline is still green before
   adding anything.
4. Re-read PLAN.md §19 (report generation) before starting M8. Notes:
   - Every signal M8's reports need already exists and is persisted:
     `ImageRecord` (inventory), `comparisons` (relationships, including
     crop/upscale warnings), and `groups` (now carrying `score`,
     `confidence`, `status`, `reasons`, `warnings`,
     `recommendedOriginalId` as of M7). This milestone is about
     *presenting* existing data, not computing anything new — resist the
     temptation to add new detection/scoring logic here.
   - PLAN.md's report almost certainly needs to distinguish
     `"automatic"` / `"manual-review"` / `"ambiguous"` groups clearly
     (the reviewer's whole job in M9 depends on being able to find the
     groups that need their attention) — check §19's exact field/section
     requirements before designing the JSON shape, then design the HTML
     as a view over that same JSON rather than a separate data path.
   - No network calls for HTML report rendering (inline CSS/JS only, no
     CDN dependencies) — same constraint as everywhere else in this repo
     (PLAN.md §35, and see this repo's own Artifact-equivalent rule of
     thumb: self-contained, no external requests).
   - Re-read the M7 section above's note on `recordsById` staleness before
     touching `run-audit.ts` again — if M8 needs any additional
     per-record data computed mid-pipeline, make sure whatever map feeds
     the report generator is built (or refreshed) *after* that data
     exists, not before.

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
