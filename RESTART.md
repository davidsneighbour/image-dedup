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

## Current state (last updated: 2026-08-01, continued through M10)

**M1-M10 are implemented, tested, and committed** (commits `e329acb`,
`6375433`, `b3b50a8`, `e8a1b3f`, `e3580de`, `842cf38`, `79b0751`,
`e55901c`, `0073bdd`, `23829a7`). Next per PLAN.md's ordering: M11
(source-code reference discovery, issue #12) — re-read PLAN.md §25
before starting it.

### M10 — what was added on top of M1-M9

- `src/consolidation/select-originals.ts` — `selectOriginals()`, the
  policy layer deciding *which* images actually get copied and what
  provenance to record (PLAN.md §22-24 read together, since the plan
  doesn't spell this decision out as its own phase). Rules: an
  `"automatic"`/`"approved"` group with a `recommendedOriginalId` copies
  only that member (every other member becomes `selectedFrom`
  provenance, never its own copy); an `"approved"` group with no
  recommendation (reviewer picked "keep multiple") or a `"rejected"`
  group ("not related") treats every member as independent; a
  `"manual-review"`/`"ambiguous"` group is excluded entirely and
  surfaced via `unresolvedGroupIds` rather than guessed at (PLAN.md
  §35). Exact-duplicate subsumption (a member loses to a byte-identical
  winner elsewhere) always overrides an unrelated group's "keep
  multiple" decision for that same image, regardless of which group is
  processed first — tested explicitly in
  `tests/unit/select-originals.test.ts`, since `computeExactDuplicateGroups`
  and `buildVisualGroups` (M3/M4) both run over the *same* full record
  set independently, so the same image can legitimately be a member of
  more than one group of different kinds.
- `src/consolidation/plan-canonical-paths.ts` — `planCanonicalPaths()`,
  implementing every PLAN.md §22.1 naming strategy
  (`original-filename`, `sanitised-filename`, `content-hash`,
  `date-slug`, `group-id`, `template`) and every §22.4 collision policy
  (`fail`, `append-hash`, `reuse-identical`, `manual-review`). Reads the
  filesystem (existing files under `originalsDirectory`) because
  `reuse-identical` can only be decided by comparing actual content —
  the only filesystem read anywhere in the planning path. Collision
  detection is case-insensitive and Unicode-normalisation-insensitive
  (`src/consolidation/sanitise-filename.ts`'s `collisionKey()`).
- `src/consolidation/select-date.ts` — `selectDate()`: trusted EXIF
  capture date, else filesystem `modifiedAt` **explicitly flagged** as a
  weak fallback (never silently treated as a capture date, per PLAN.md
  §22.3), else `"unknown-date"`. PLAN.md's "configured source date" tier
  has no corresponding config field anywhere in `configSchema` and was
  skipped rather than invented — flagged in the README's known
  limitations.
- `src/consolidation/copy-and-verify.ts` — `copyAndVerifyEntry()`: the
  actual PLAN.md §23.1 sequence. Re-hashes the *source* immediately
  before copying (never trusts the audit snapshot — the file may have
  changed since `audit` last ran) and fails that one entry loudly rather
  than copying a since-modified file under a stale id. Copies with
  `COPYFILE_EXCL` (never overwrites — collision resolution already
  happened during planning; an existing destination here means the
  filesystem changed underneath the plan), fsyncs, hashes the
  destination, and compares against the source hash.
- `src/consolidation/run-consolidation.ts` — `runConsolidation()`, the
  orchestration entry point. Collisions always abort the **entire** run
  before any file is copied — PLAN.md's "collisions fail safely" and "no
  mutation without --apply" both require all-or-nothing, not a partial
  copy followed by a mid-run error. `<workspace>/manifest.preview.json`
  is written on every run, dry-run or not (PLAN.md §23.1 step 6 happens
  before the copy steps). `--apply` additionally: copies+verifies every
  entry, records each `ConsolidationOperation` into the new `operations`
  SQLite table (`src/persistence/repositories/operations.ts`, migration
  v6) *and* a human-readable `<workspace>/journal/<runId>.json`
  (`src/consolidation/journal-file.ts` — the DB table is authoritative
  for rollback, the JSON file is just for inspection), and writes
  `<originalsDirectory>/manifest.json` (excluding any entry whose copy
  failed verification).
- `src/consolidation/rollback-consolidation.ts` — `rollbackConsolidation()`.
  Three independent safety checks gate every removal (PLAN.md §23.4): the
  operation actually completed (`status === "verified"`, not
  `"skipped-identical"`/`"failed"`/already `"rolled-back"`); the
  destination's *current* hash still matches what this run wrote there
  (refuses to remove content that's been touched since); and no later
  run's operations also reference the same destination (a subsequent
  `consolidate --apply` may have re-verified or reused that exact path —
  removing it would pull the rug out from under that later run). Doesn't
  parse or rewrite `<originalsDirectory>/manifest.json` — flagged as a
  known limitation in the README (re-run `consolidate --apply` after a
  rollback to regenerate it).
- `image-origin rollback` is a **separate top-level CLI command**, not
  `consolidate rollback` — nesting it would give `consolidate` (which
  needs its own `--workspace` for its default action) a child command
  needing the same option name, exactly the Commander.js parent/child
  option-shadowing bug already hit and fixed once in M9 (see
  `src/cli/commands/review.ts`'s comment). Documented in
  `src/cli/commands/rollback.ts` so nobody "fixes" this by renesting it.
- `src/domain/manifest.ts` (+ `schemas/manifest.schema.json`) and
  `src/domain/operation.ts` — the canonical manifest (PLAN.md §24) and
  operation journal entry (§23.3) types/zod schemas, following the same
  "hand-kept in sync with a JSON Schema file" precedent as
  `json-report.ts`/`review-decision.ts`. Operation `source`/`destination`
  are absolute paths (not the repo-relative-looking strings in PLAN.md's
  illustrative example) — deliberate, since rollback runs later, possibly
  from a different working directory, and needs entries to stay
  filesystem-actionable independent of cwd.
- Manually verified against the built CLI end-to-end (not just unit/
  integration tests): dry-run plan → apply (files copied, hashes
  verified, manifest + journal written) → second apply failing safely
  with exit code 5 on collision → `rollback` dry-run (nothing removed) →
  `rollback --apply` (files actually removed, `manifest.json`
  deliberately left in place and now stale, per the limitation above).

### M9 — what was added on top of M1-M8

- `src/review/import-decisions.ts` — `importReviewDecisions()`, the
  orchestration entry point for `image-origin review import`
  (PLAN.md §21). Reads and zod-validates the `--decisions` file, reads
  and zod-validates `<workspace>/audit.json` (the report snapshot the
  reviewer actually saw — written by `report`, M8), opens the workspace
  DB, and runs validation before touching anything. Applying happens in
  a single `db.transaction()`, matching this workspace's "use
  transactions for state-changing operations" contract (PLAN.md §6).
- `src/review/validate-decisions.ts` — `validateDecisions()`, pure, no
  I/O. Splits a decision batch into `valid` / `invalid` / `stale`:
  - `invalid` (always blocks the whole import, nothing applied):
    duplicate decisions for the same `groupId` in one file, a `groupId`
    absent from the snapshot, a `selectedImageId` that isn't a member of
    that group, or an `approve-recommendation` that doesn't select the
    group's actual `recommendedOriginalId`.
  - `stale`: the decision is structurally fine against the snapshot, but
    the *live* group (current DB state) has different membership than
    the snapshot did — i.e. `audit` was re-run after `report` wrote
    `audit.json` but before this import. Blocks the import unless
    `--force-stale-decisions`.
  - The same function does double duty for the forced-stale re-check:
    calling it with the live-groups map passed as *both* the
    "reference" and "live" argument makes staleness trivially
    unsatisfiable (a map matches itself), so it validates a decision
    directly against current truth. `import-decisions.ts` uses exactly
    this to re-check only the stale subset after `--force-stale-decisions`
    — a decision that's still nonsensical against the group as it exists
    *now* (e.g. its selected image was itself removed) is skipped, not
    blindly forced through.
- `src/review/apply-decision.ts` — `applyDecisionToGroup()`, pure.
  `approve-recommendation` → `status: "approved"`, keeps
  `recommendedOriginalId`/`score` as-is. `select-different` → `status:
  "approved"`, `recommendedOriginalId` becomes the human's pick, `score`
  cleared (it described the machine's candidate, not this one).
  `keep-multiple` → `"approved"`, both cleared (no single winner).
  `not-related` → `"rejected"`, both cleared. `defer` → no change beyond
  appending a reason. A `"Reviewed by human: <action> — <note>"` entry is
  always appended to `reasons` (never replaces the automatic-scoring
  reasons already there, so the audit trail stays intact).
- **Relaxed `imageGroupSchema`'s score-required constraint**
  (`src/domain/image-group.ts`): previously *any* `"visual"` group with
  `recommendedOriginalId` set required `score`. Now only required while
  `status === "automatic"` — once a human has approved/overridden a
  recommendation, the score described the machine's own (possibly now
  superseded) candidate and is correctly clearable. No test relied on
  the old, stricter behaviour.
- `src/review/decisions-file.ts` — `readDecisionsFile`/`writeDecisionsFile`/
  `mergeDecisions`, the `<workspace>/decisions.json` persisted record of
  applied decisions (PLAN.md §6) — distinct from the `--decisions` file a
  reviewer passes in, which lives wherever they downloaded it from the
  HTML report. `mergeDecisions` is keyed by `groupId`: re-importing after
  a reviewer changes their mind overwrites that group's stored decision
  in place rather than appending a duplicate. Same "absent/invalid file
  treated as empty, not a hard error" precedent as
  `config/resolved-config-file.ts`.
- `src/persistence/repositories/groups.ts` gained `listAllGroups()`
  (both kinds, for building the live-groups map) and `updateGroup()`
  (patches one row by `id` — unlike `replaceGroupsOfKind`'s wholesale
  recompute, review import only ever touches the specific groups a human
  made a decision about).
- `src/cli/format-zod-error.ts` — extracted from `config/load-config.ts`
  (was a private function there) since review import needed the same
  zod-error formatting for decisions/report-schema failures. No
  behaviour change to `load-config.ts`.
- **`ReviewDecision`'s optional fields (`src/domain/review-decision.ts`)
  gained explicit `| undefined`** (`selectedImageId?: string |
  undefined`, not just `selectedImageId?: string`) — under
  `exactOptionalPropertyTypes`, zod's `.optional()` output type always
  includes an explicit `| undefined`, so a hand-written interface without
  it isn't assignable from `reviewDecisionsSchema.parse()`'s result. This
  is the first place in the codebase that consumes a parsed-schema result
  as its paired hand-written domain type rather than just validating an
  already-typed value — **if a future milestone does the same with
  `ImageGroup`/`imageGroupSchema` or `JsonReport`/`jsonReportSchema`,
  expect the identical class of type error** (import-decisions.ts works
  around it for `ImageGroup` with a narrow, commented `as ImageGroup[]`
  cast on `audit.json`'s already-schema-validated `groups`, rather than
  loosening `ImageGroup`/`ImageComparison` themselves — `relationship` in
  particular is `z.string()` in the schema but `ImageRelationship` (a
  real union) in the domain type, a pre-existing looseness not worth
  tightening just for this).
- **Real bug found via manual CLI testing against the built `dist/`, not
  caught by any test**: `image-origin review import --workspace X
  --decisions Y` always failed with `error: required option '--workspace
  <path>' not specified` even though `--workspace` was clearly passed.
  Root cause: the parent `review` command (in `src/cli/commands/review.ts`)
  declared its own `--workspace` option (leftover from the old stub);
  Commander.js resolves a parent-level option against the *entire*
  remaining argument list, including tokens meant for a subcommand's own
  `requiredOption` of the same name — the parent silently "claims" the
  value and the child's `requiredOption` check then reports it as never
  supplied. Fixed by removing the redundant parent-level option (the
  parent command's action never used it anyway). **If you ever add
  another `program.command(x).option(...)` parent with a
  `x.command(y).requiredOption(...)` child sharing an option name, this
  will silently reoccur** — verified by writing a 15-line reproduction
  against bare `commander` directly (not this codebase) before landing
  the fix, and by then actually running the built CLI end-to-end (audit →
  report → review import, including the invalid-group-id and
  stale-without-force rejection paths) — this is exactly the class of bug
  `--help` output or unit tests alone would never surface, since nothing
  before this milestone had a subcommand nested under a command with its
  own options.

### M8 — what was added on top of M1-M7

M8 is the first milestone where a *second* command (`report`) reads back
state that `audit` produced in a prior, separate invocation — everything
below either serves that JSON/HTML report deliverable directly, or is a
plumbing gap that only became visible once something actually needed to
reconstruct config from a bare workspace.

- `src/reporting/json-report.ts` — the PLAN.md §19 JSON report. `JsonReport`
  + `jsonReportSchema` (zod) are hand-kept in sync with
  `schemas/report.schema.json` (a real JSON Schema file, for external
  consumers — not runtime-enforced; `assertValidJsonReport` via the zod
  schema is what actually gates a write). `buildJsonReport()` is a pure
  function: sorts images by path then id and groups by id so output is
  deterministic regardless of caller array order, computes a config
  fingerprint (sha256 of the resolved config) and the summary counts.
  **Known, deliberate limitation**: `summary.filesDiscovered` and
  `filesInspected` are both just the persisted image-record count —
  discovery-time skip counts (unsupported/inaccessible/duplicate-path/
  symlink-skipped) are transient to a single `audit` run's in-memory
  `RunAuditResult` and were never persisted to the workspace database, so
  a standalone `report` run (which may happen long after `audit`) has no
  way to recover them. Fixing this properly would mean adding a persisted
  "last run summary" to the DB — out of scope for this milestone, flagged
  here for whoever eventually wants exact discovery-vs-inspection counts
  in the report.
- `src/reporting/thumbnails.ts` / `detail-crops.ts` — sharp-based asset
  generation, cached by content hash under `<workspace>/cache/` (so
  re-running `report` regenerates nothing) and copied into
  `<workspace>/report/assets/` so the report directory is portable on its
  own. Detail crops (PLAN.md §20.3: centre + highest-detail region) use a
  small flat grid search scored by Laplacian-stdev (same idea as M6's
  upscale detector, but a deliberately independent implementation — that
  one scores a whole image for upscale detection, this one ranks
  candidate *regions* within one image, a different comparison). Only
  generated for images that are actually members of a group
  (`src/reporting/report-assets.ts`) — ungrouped images have nothing to
  compare against in review, so there's no point spending decode time.
  **Deliberately skips EXIF auto-rotation** for crop-box math (unlike
  `thumbnails.ts`, which does auto-rotate since it's pure display) — boxes
  are computed and extracted against the same raw/stored pixel grid as
  `record.image.width`/`height` everywhere else in this codebase, avoiding
  an orientation-swap bug where a box computed pre-rotation gets extracted
  post-rotation.
- `src/reporting/html/` — the static HTML report (PLAN.md §20). No build
  step: `styles.ts`/`client-script.ts` are plain CSS/JS as TS template
  string constants, embedded verbatim by `render-report.ts`. Two security
  properties worth knowing if you touch this:
  1. The report's own JSON data is embedded **inline** (a
     `<script type="application/json" id="report-data">` the client reads
     via `JSON.parse(el.textContent)`), not fetched — `fetch()` of a
     sibling file over `file://` is unreliable across browsers, unlike
     `<img src>`, which loads local relative paths fine. This is *why* the
     HTML report works when just double-clicked, no server needed.
  2. `escape.ts`'s `escapeJsonForScriptTag` replaces every `<` in the
     serialized JSON with `<` before embedding — otherwise a
     malicious source filename containing the literal bytes `</script`
     (impossible from a single filename component on POSIX, since `/` is
     forbidden in one, but trivially achievable across a real path
     separator: a directory named `foo<` containing a file named
     `script>...` — see the regression test in
     `tests/integration/report-generation.test.ts`) could prematurely
     close the data tag and inject a sibling `<script>`. The client script
     itself only ever builds DOM via `createElement`/`textContent`, never
     `innerHTML` with concatenated strings, so nothing needs
     HTML-escaping there either. CSP is applied via `<meta>`
     (`default-src 'none'`, inline script/style allowed since there's no
     server to hand out nonces, no external resources, no `connect-src`) —
     `frame-ancestors` is deliberately **not** included, browsers ignore
     it entirely when delivered via `<meta>` and it just logs a console
     warning for nothing.
  3. Verified interactively via Playwright against the real generated
     HTML (served over a throwaway local HTTP server — Playwright's
     `file://` navigation is blocked in this environment, so an HTTP
     server was used purely as a test harness; the report itself is still
     designed to work directly from `file://`): group list renders,
     filtering by confidence/relationship/unresolved-only all work,
     clicking a member sets a decision, "Export decisions" downloads a
     JSON file that validates against `reviewDecisionsSchema`, zero
     console errors.
- `src/domain/review-decision.ts` — `ReviewDecision` + zod schema (PLAN.md
  §5.4), matched by `schemas/review-decision.schema.json`. Exists now
  because the HTML report's "export decisions" button needs a schema to
  target; consumed later by M9's `review import`.
- **Plumbing gap found and fixed**: `report` has no `--input` flag (it
  only reads an existing workspace, it doesn't scan), but `configSchema`
  requires `inputs` unconditionally — so `report --workspace <ws>` with no
  `--config` failed with "inputs: Required" even against a workspace a
  real `audit` had just populated. Caught by manually running the actual
  CLI end-to-end (`audit` then `report`), not by any test. PLAN.md §6's
  workspace layout already lists `config.resolved.json` for exactly this
  purpose but nothing had ever written or read it (M1-M7 only ever needed
  `audit`, a single self-contained command). Fixed with
  `src/config/resolved-config-file.ts`
  (`writeResolvedConfig`/`readResolvedConfig`) — `audit` now persists its
  resolved config into the workspace after `loadConfig` succeeds, and
  `report`'s `resolveReportConfig()` reads it back when `--config` isn't
  given, falling back to the normal `loadConfig` contract (still requires
  `--config` or otherwise-resolvable `inputs`) if the file is missing or
  no longer validates against the current schema — e.g. a workspace from
  before this existed, or an intentionally different config file. **If
  you add a new command that needs to operate against an existing
  workspace without rescanning, use this same fallback pattern** rather
  than requiring `--config` unconditionally.
- `src/cli/package-version.ts` — `readPackageVersion()` extracted out of
  `cli/index.ts` (it needed the tool version too, for the `--version`
  flag; the JSON report needs it for `toolVersion`) — no behaviour change,
  just deduplication.

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
2. `gh issue list --label type:enhancement` and read open issues — #11
   (M10: consolidation) is next per PLAN.md's ordering.
3. Run `npm run lint && npm run typecheck && npm test && npm run build`
   (and maybe `npm audit`) to confirm the baseline is still green before
   adding anything.
4. Re-read PLAN.md §22-24 (path planning, consolidation, manifest) before
   starting M10. Notes:
   - This is the first milestone that actually **mutates the filesystem**
     outside the workspace — everything through M9 only ever read source
     images and wrote into `<workspace>/`. `--apply` (mutations) vs.
     `--yes` (skip confirmation) are explicitly *not* the same flag
     (PLAN.md §23.2) — don't conflate them, and default to a dry-run plan
     with no writes when `--apply` is absent, matching `consolidate.ts`'s
     existing stub option set.
   - Only `"approved"` groups (or ungrouped/singleton originals?  re-read
     §23 for exactly which images qualify) should ever be considered for
     consolidation — M9's `review import` is what gets a group *to*
     `"approved"`/`"rejected"`; a group still `"manual-review"` or
     `"ambiguous"` has no human-confirmed original and must not be
     silently consolidated.
   - §23.3's operation journal + §23.4's rollback need real hash
     verification (copy, hash the destination, compare) before a copy is
     considered "verified" — don't trust a copy succeeded just because no
     exception was thrown.
   - §22.3's date-selection precedence (trusted capture date → embedded
     metadata date → configured source date → filesystem mtime only as a
     weak fallback → `unknown-date`) matters for the `date-and-slug`
     naming strategy — filesystem mtime is explicitly called out as
     untrustworthy for this, don't default to it.
   - §22.4's collision policy defaults to `"fail"` — don't silently
     overwrite or auto-rename unless a non-default policy is configured.

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
