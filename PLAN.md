# Image origin audit and consolidation system

## Objective

Build a reusable tool that scans one or more directories containing historical website assets, identifies files that represent the same underlying image, evaluates which candidate is the best available source, and safely consolidates the selected source image into a canonical originals directory.

The system must distinguish archival source images from generated website derivatives.

The primary principle is:

> Originals are curated inputs. Responsive images, thumbnails, format conversions, and optimised variants are generated outputs.

The tool must not assume that the image with the largest dimensions, largest file size, newest timestamp, or most modern format is automatically the best original.

It must produce explainable recommendations, support human review, and make no destructive changes without explicit approval.

---

# 1. Scope

## 1.1 In scope

The first implementation must support:

* JPEG
* PNG
* WebP
* AVIF, where supported by the installed image-processing library
* GIF metadata inspection
* exact duplicate detection
* visually similar image detection
* resized derivative detection
* format-converted derivative detection
* probable recompression detection
* probable crop detection
* probable upscaling detection
* source-quality ranking
* confidence scoring
* machine-readable reports
* human-readable reports
* safe consolidation into a canonical originals directory
* verification of all file operations
* optional source-code reference discovery
* optional source-code reference replacement
* dry-run operation for every mutating command
* resumable processing for large repositories

## 1.2 Out of scope for the initial implementation

Do not attempt automatic handling of the following in the first version:

* advanced facial or semantic image recognition
* object-level image matching
* AI-generated image-quality assessment
* automatic copyright or licence determination
* automatic deletion of rejected files
* destructive EXIF rewriting
* automatic retouching
* restoration of damaged images
* reconstruction of missing originals
* automatic choice between meaningfully edited image variants
* automatic replacement of visually distinct crops
* video files
* SVG visual comparison
* PSD, TIFF, RAW, or proprietary design formats unless added explicitly later

These cases may be detected and reported, but must be left for manual review.

---

# 2. Expected user workflow

The final CLI should support the following lifecycle:

```bash
image-origin audit \
  --input ./public \
  --input ./backups \
  --output ./.image-origin

image-origin report \
  --workspace ./.image-origin

image-origin review \
  --workspace ./.image-origin

image-origin consolidate \
  --workspace ./.image-origin \
  --originals ./src/assets/originals \
  --dry-run

image-origin consolidate \
  --workspace ./.image-origin \
  --originals ./src/assets/originals \
  --apply

image-origin references \
  --workspace ./.image-origin \
  --root . \
  --dry-run

image-origin verify \
  --workspace ./.image-origin \
  --originals ./src/assets/originals
```

The tool should also support a single command for non-interactive CI use:

```bash
image-origin audit \
  --config ./image-origin.config.mjs \
  --format json \
  --non-interactive
```

---

# 3. Repository setup

## 3.1 Technology choices

Use:

* Node.js 24 or newer
* TypeScript
* ESM only
* strict TypeScript configuration
* npm
* Vitest
* Biome
* `sharp` for image decoding, metadata, normalisation, resizing, and pixel extraction
* SQLite for persistent scan state and large repositories
* `better-sqlite3` unless repository constraints require another SQLite package
* `commander` or `citty` for the CLI
* `zod` for configuration and manifest validation
* a perceptual hashing implementation that supports pHash, dHash, or equivalent
* an SSIM implementation for confirmation comparisons
* `fast-glob` for discovery
* `p-limit` for concurrency control
* `execa` only where subprocess execution is genuinely required

Avoid adding a large web framework for the first report implementation. Generate a static HTML report with client-side JavaScript unless the repository already has a suitable framework.

## 3.2 Suggested structure

```text
image-origin/
├── src/
│   ├── cli/
│   │   ├── commands/
│   │   │   ├── audit.ts
│   │   │   ├── report.ts
│   │   │   ├── review.ts
│   │   │   ├── consolidate.ts
│   │   │   ├── references.ts
│   │   │   └── verify.ts
│   │   ├── output.ts
│   │   └── index.ts
│   ├── config/
│   │   ├── schema.ts
│   │   ├── defaults.ts
│   │   └── load-config.ts
│   ├── discovery/
│   │   ├── discover-files.ts
│   │   ├── supported-formats.ts
│   │   └── ignore-rules.ts
│   ├── inventory/
│   │   ├── inspect-image.ts
│   │   ├── metadata.ts
│   │   ├── exact-hash.ts
│   │   └── quality-signals.ts
│   ├── matching/
│   │   ├── perceptual-hash.ts
│   │   ├── candidate-index.ts
│   │   ├── aspect-ratio.ts
│   │   ├── similarity.ts
│   │   ├── crop-detection.ts
│   │   └── grouping.ts
│   ├── analysis/
│   │   ├── upscale-detection.ts
│   │   ├── compression-analysis.ts
│   │   ├── detail-analysis.ts
│   │   ├── metadata-analysis.ts
│   │   └── relationship-classifier.ts
│   ├── scoring/
│   │   ├── score-candidate.ts
│   │   ├── explain-score.ts
│   │   └── confidence.ts
│   ├── persistence/
│   │   ├── database.ts
│   │   ├── migrations.ts
│   │   ├── repositories/
│   │   └── transactions.ts
│   ├── reporting/
│   │   ├── json-report.ts
│   │   ├── html-report.ts
│   │   ├── thumbnails.ts
│   │   └── detail-crops.ts
│   ├── review/
│   │   ├── decisions.ts
│   │   ├── decision-schema.ts
│   │   └── apply-review.ts
│   ├── consolidation/
│   │   ├── path-planner.ts
│   │   ├── copy-original.ts
│   │   ├── collision-policy.ts
│   │   ├── manifest.ts
│   │   └── rollback.ts
│   ├── references/
│   │   ├── search-references.ts
│   │   ├── classify-reference.ts
│   │   ├── replace-references.ts
│   │   └── supported-source-files.ts
│   ├── verification/
│   │   ├── verify-files.ts
│   │   ├── verify-hashes.ts
│   │   ├── verify-references.ts
│   │   └── verify-manifest.ts
│   ├── domain/
│   │   ├── image-record.ts
│   │   ├── image-group.ts
│   │   ├── relationship.ts
│   │   └── decision.ts
│   └── index.ts
├── schemas/
│   ├── manifest.schema.json
│   ├── report.schema.json
│   └── decisions.schema.json
├── fixtures/
│   ├── exact-duplicates/
│   ├── resized/
│   ├── recompressed/
│   ├── converted/
│   ├── cropped/
│   ├── upscaled/
│   ├── transparent/
│   └── unrelated/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── docs/
│   ├── architecture.md
│   ├── scoring.md
│   ├── workflow.md
│   └── limitations.md
├── image-origin.config.example.mjs
├── package.json
├── tsconfig.json
├── biome.json
└── README.md
```

---

# 4. Configuration design

Create a validated configuration file.

Example:

```js
export default {
  inputs: [
    "./public",
    "./backups",
    "./legacy-assets",
  ],

  workspace: "./.image-origin",
  originalsDirectory: "./src/assets/originals",

  include: [
    "**/*.{jpg,jpeg,png,webp,avif,gif}",
  ],

  exclude: [
    "**/node_modules/**",
    "**/.git/**",
    "**/.cache/**",
    "**/dist/**",
    "**/.image-origin/**",
  ],

  matching: {
    exactHash: true,
    perceptualHash: true,
    perceptualDistanceThreshold: 10,
    ssimThreshold: 0.96,
    aspectRatioTolerance: 0.015,
    detectCrops: true,
    detectRotation: true,
  },

  quality: {
    detectUpscaling: true,
    detectCompressionArtifacts: true,
    inspectMetadata: true,
    preserveColourProfiles: true,
    preferLosslessWhenSourceEquivalent: true,
  },

  review: {
    automaticConfidenceThreshold: 0.97,
    manualReviewThreshold: 0.7,
    neverAutoSelectCrops: true,
    neverAutoSelectEditedVariants: true,
  },

  consolidation: {
    naming: "content-hash",
    preserveExtension: true,
    copyInsteadOfMove: true,
    collisionPolicy: "fail",
    writeManifest: true,
  },

  references: {
    enabled: true,
    sourceExtensions: [
      ".astro",
      ".html",
      ".css",
      ".scss",
      ".js",
      ".mjs",
      ".ts",
      ".tsx",
      ".jsx",
      ".json",
      ".yaml",
      ".yml",
      ".md",
      ".mdx",
    ],
  },

  concurrency: {
    discovery: 16,
    metadata: 8,
    decoding: 4,
    comparison: 2,
  },
};
```

Requirements:

* support CLI overrides;
* validate all values;
* report invalid configuration clearly;
* print the resolved configuration in verbose mode;
* make defaults conservative;
* never enable destructive actions through configuration alone;
* require an explicit `--apply` flag for mutations.

---

# 5. Data model

## 5.1 Image record

Each discovered image must produce a record similar to:

```ts
export interface ImageRecord {
  id: string;
  path: string;
  realPath: string;
  relativePath: string;

  file: {
    sizeBytes: number;
    modifiedAt: string;
    createdAt?: string;
    sha256: string;
  };

  image: {
    format: string;
    width: number;
    height: number;
    aspectRatio: number;
    orientation?: number;
    pages: number;
    hasAlpha: boolean;
    bitDepth?: number;
    channels?: number;
    colourSpace?: string;
    density?: number;
  };

  metadata: {
    exifPresent: boolean;
    iptcPresent: boolean;
    xmpPresent: boolean;
    iccPresent: boolean;
    captureDate?: string;
    cameraMake?: string;
    cameraModel?: string;
    copyright?: string;
    creator?: string;
  };

  hashes: {
    sha256: string;
    perceptual?: string;
    difference?: string;
  };

  quality: {
    detailScore?: number;
    sharpnessScore?: number;
    compressionScore?: number;
    noiseScore?: number;
    probableUpscale?: boolean;
    probableRecompression?: boolean;
  };

  warnings: string[];
}
```

## 5.2 Relationship types

Use explicit relationship types:

```ts
export type ImageRelationship =
  | "exact-duplicate"
  | "metadata-only-difference"
  | "format-conversion"
  | "resize"
  | "recompression"
  | "resize-and-recompression"
  | "crop"
  | "rotation"
  | "mirrored"
  | "colour-adjusted"
  | "watermarked"
  | "upscaled"
  | "animation-frame"
  | "visually-related"
  | "unknown";
```

Do not collapse every relationship into `duplicate`.

## 5.3 Group record

```ts
export interface ImageGroup {
  id: string;
  members: string[];
  comparisons: ImageComparison[];
  recommendedOriginalId?: string;
  confidence: number;
  status:
    | "automatic"
    | "manual-review"
    | "approved"
    | "rejected"
    | "ambiguous";
  reasons: string[];
  warnings: string[];
}
```

## 5.4 Review decision

```ts
export interface ReviewDecision {
  groupId: string;
  selectedImageId?: string;
  action:
    | "approve-recommendation"
    | "select-different"
    | "keep-multiple"
    | "not-related"
    | "defer";
  selectedAt: string;
  note?: string;
}
```

---

# 6. Persistent workspace

The tool must create a workspace such as:

```text
.image-origin/
├── database.sqlite
├── config.resolved.json
├── audit.json
├── decisions.json
├── manifest.preview.json
├── logs/
├── cache/
│   ├── thumbnails/
│   ├── normalised/
│   └── detail-crops/
└── report/
    ├── index.html
    ├── assets/
    └── data/
```

Requirements:

* do not rescan unchanged files;
* identify unchanged files using path, size, modification time, and hash;
* permit `--force` to invalidate caches;
* store schema version;
* support database migrations;
* use transactions for state-changing operations;
* make interrupted scans resumable;
* record all errors without aborting the complete scan unless the database becomes unusable.

---

# 7. Phase 1: file discovery

Implement file discovery first.

## 7.1 Requirements

* accept multiple input directories;
* support absolute and relative paths;
* resolve symlinks safely;
* detect symlink loops;
* optionally ignore symlinks;
* support include and exclude globs;
* ignore unsupported formats;
* detect files by content where extension and actual format differ;
* record inaccessible files;
* record corrupted files;
* avoid reading generated report files;
* produce deterministic ordering.

## 7.2 Output

For each file, report one of:

* discovered
* ignored
* unsupported
* inaccessible
* corrupted
* duplicate path
* symlink skipped

## 7.3 Tests

Add fixtures for:

* duplicate paths through symlinks;
* hidden files;
* uppercase extensions;
* extensionless image files;
* incorrect file extensions;
* corrupted files;
* nested excluded directories.

---

# 8. Phase 2: inventory and metadata extraction

Use `sharp` to inspect each image.

## 8.1 Required metadata

Collect:

* format
* dimensions
* orientation
* page count
* density
* colour space
* channels
* alpha
* bit depth where available
* ICC profile presence
* EXIF presence
* IPTC presence
* XMP presence
* creation or capture date where available
* creator and copyright fields where available

Do not expose sensitive metadata automatically in public reports. The local report may display metadata, but the generated manifest should support a metadata allowlist.

## 8.2 Exact hash

Calculate SHA-256 over the original bytes.

Use SHA-256 for:

* exact duplicate detection;
* stable file identity;
* post-copy verification;
* manifest integrity.

## 8.3 Normalised representation

For perceptual analysis, create a normalised representation:

* apply orientation;
* convert to a consistent colour space;
* strip metadata;
* flatten alpha only for algorithms that require it;
* preserve a separate alpha-aware representation;
* resize to configured analysis dimensions;
* avoid writing temporary files unless necessary.

Document every normalisation step.

---

# 9. Phase 3: exact duplicate detection

Group files with identical SHA-256 hashes.

Requirements:

* exact groups must be deterministic;
* identical bytes with different names belong to the same exact group;
* do not automatically choose the preferred path as the original;
* preserve all paths in the report;
* mark hard links separately where detectable;
* report wasted storage as an informational metric;
* do not delete any duplicate.

Selection within exact duplicates may use path preferences, metadata, or directory policy, but the binary content is equivalent.

Example path preference configuration:

```js
pathPreferences: [
  {
    pattern: "backups/originals/**",
    weight: 20,
  },
  {
    pattern: "public/generated/**",
    weight: -20,
  },
];
```

---

# 10. Phase 4: perceptual hashing and candidate generation

Do not compare every image with every other image.

## 10.1 Candidate filtering

Use inexpensive filters before SSIM or pixel comparison:

* aspect-ratio buckets;
* perceptual hash distance;
* width and height ratios;
* colour histogram coarse similarity;
* alpha compatibility;
* animation compatibility.

## 10.2 Perceptual hashes

Calculate at least two complementary hashes if practical:

* pHash for structural similarity;
* dHash for edge and gradient similarity.

Store both.

A hash match is only a candidate signal. It is not final proof.

## 10.3 Candidate index

Build a searchable candidate index.

Possible strategies:

* buckets based on initial hash bits;
* BK-tree for Hamming distance;
* SQLite indexes for coarse grouping;
* aspect-ratio partitions.

The system must scale to at least 50,000 image files without performing a full pairwise comparison.

## 10.4 Tests

Include:

* resized JPEG versus source JPEG;
* JPEG versus WebP;
* unrelated visually similar images;
* monochrome images;
* logos with minor colour changes;
* images with borders;
* rotated images;
* mirrored images.

---

# 11. Phase 5: visual confirmation

Use more expensive comparison only after candidate generation.

## 11.1 SSIM comparison

For candidates with matching aspect ratios:

* apply orientation;
* resize both to common dimensions;
* compare luminance and colour where possible;
* calculate SSIM;
* store comparison dimensions;
* store threshold used;
* record the comparison method.

Do not compare only tiny thumbnails. Use multiple scales where practical.

Suggested process:

1. compare at 256 pixels;
2. compare at 1024 pixels if the first result is plausible;
3. inspect selected detail regions for high-confidence ranking.

## 11.2 Alpha comparison

For files with transparency:

* compare RGB and alpha independently;
* do not flatten both against white and declare them identical;
* report when one candidate has meaningful transparency and another does not.

## 11.3 Rotation and mirroring

Support optional checks for:

* 90-degree rotations;
* 180-degree rotation;
* horizontal mirroring;
* vertical mirroring.

Do not enable expensive transformations unless the initial candidate score justifies them.

---

# 12. Phase 6: crop detection

Cropped images must not be treated as ordinary resized duplicates.

## 12.1 Detection strategy

Implement a conservative crop detector.

Possible approach:

* create downscaled greyscale feature maps;
* compare one image as a possible subregion of another;
* use feature matching or sliding-window correlation;
* require a high match confidence;
* calculate retained area percentage;
* detect added borders separately.

## 12.2 Output

A crop comparison should report:

```json
{
  "relationship": "crop",
  "largerImageId": "image-a",
  "croppedImageId": "image-b",
  "retainedArea": 0.74,
  "cropBox": {
    "left": 0.12,
    "top": 0.04,
    "width": 0.79,
    "height": 0.88
  },
  "confidence": 0.93
}
```

## 12.3 Safety rule

Never automatically discard a crop.

A crop may be an intentional editorial asset rather than an inferior copy.

The report should usually recommend the full uncropped image as the archival source while preserving the crop relationship.

---

# 13. Phase 7: probable upscaling detection

Dimensions alone are not enough.

## 13.1 Signals

Use several signals:

* edge sharpness relative to dimensions;
* repeated interpolation patterns;
* low high-frequency detail;
* similarity to a smaller candidate after downscaling;
* lack of additional detail in the larger candidate;
* dimensions matching common upscale multipliers;
* metadata from known processing tools, where available.

## 13.2 Pairwise detail comparison

When a large image and smaller candidate appear equivalent:

1. downscale the larger image to the smaller candidate's dimensions;
2. compare them;
3. upscale the smaller candidate using a known high-quality method;
4. compare detail-frequency profiles;
5. determine whether the large file contains measurable extra detail.

The output must say `probableUpscale`, not `upscaled`, unless the evidence is conclusive.

## 13.3 Safety rule

An image marked as a probable upscale must receive a substantial ranking penalty.

Do not reject it outright when it is the only complete available candidate.

---

# 14. Phase 8: compression and detail analysis

## 14.1 Compression signals

Estimate:

* JPEG blocking;
* ringing around edges;
* mosquito noise;
* colour banding;
* chroma subsampling effects;
* WebP or AVIF artefacts where detectable;
* repeated lossy recompression.

Do not present a guessed JPEG quality number as authoritative. Label estimates clearly.

## 14.2 Detail score

Create a detail score using:

* Laplacian variance;
* high-frequency energy;
* edge density;
* local contrast;
* texture retention.

Normalise detail scores by image dimensions and content type where possible.

A flat illustration should not be penalised merely because it contains fewer natural textures than a photograph.

## 14.3 Content-type heuristic

Optionally classify images into broad types:

* photograph
* illustration
* screenshot
* logo or icon
* transparent graphic
* unknown

Use this only to tune comparison and scoring. Do not make it a required dependency.

---

# 15. Phase 9: relationship classification

For every confirmed pair, classify the most likely relationship.

Use explicit rules.

Examples:

## Exact duplicate

Conditions:

* identical SHA-256.

## Metadata-only difference

Conditions:

* decoded pixels identical;
* file bytes differ;
* metadata or container structure differs.

## Resize

Conditions:

* same visual content;
* same aspect ratio;
* dimensions differ;
* no substantial colour or compression difference beyond resizing.

## Format conversion

Conditions:

* same dimensions or equivalent decoded pixels;
* different formats;
* no clear crop.

## Recompression

Conditions:

* same dimensions;
* high visual similarity;
* compression artefacts differ.

## Resize and recompression

Conditions:

* dimensions differ;
* high visual similarity;
* lossy artefacts differ.

## Crop

Conditions:

* one image corresponds to a subregion of another.

## Colour-adjusted

Conditions:

* structural similarity is high;
* colour histogram or tone mapping differs materially.

## Watermarked

Initial implementation may only flag suspected watermarks when:

* a localised overlay exists;
* the rest of the image matches strongly.

Keep this classification conservative.

---

# 16. Phase 10: group construction

Pairwise relationships must be converted into image groups.

## 16.1 Graph model

Represent images as nodes and relationships as weighted edges.

Use connected components cautiously. A weak chain must not merge unrelated images.

Example risk:

* image A resembles image B;
* image B resembles image C;
* image A does not sufficiently resemble image C.

Implement one of:

* complete-linkage clustering;
* strong-edge connected components;
* group validation against a representative;
* split groups with inconsistent pairwise relationships.

## 16.2 Group rules

A group should contain images believed to originate from the same underlying image.

Do not group:

* distinct crops showing different subjects;
* different frames from a burst;
* visually similar stock photographs;
* logos with meaningful brand changes;
* screenshots of different application states.

Ambiguous groups must be marked for manual review.

---

# 17. Phase 11: source-quality ranking

The ranking system must be explainable and configurable.

## 17.1 Hard disqualifiers

Do not automatically select a candidate when it is:

* corrupted;
* partially decoded;
* a detected crop and a complete candidate exists;
* a suspected watermark and an unwatermarked candidate exists;
* a probable upscale and a genuine smaller source exists;
* missing meaningful transparency available elsewhere;
* a single extracted frame when an animated source exists;
* visibly colour-reduced compared with another source;
* a thumbnail embedded in metadata;
* a generated placeholder.

These are disqualifiers for automatic selection, not necessarily reasons for deletion.

## 17.2 Suggested score components

Use a 0 to 100 score with documented weights.

Example:

```text
native detail                  0–30
effective resolution           0–20
compression quality            0–15
completeness and uncropped      0–10
colour fidelity                 0–8
bit depth                       0–5
alpha preservation              0–4
ICC profile                     0–3
useful metadata                 0–3
preferred source path           0–2
```

Penalties:

```text
probable upscale              -25
confirmed crop                -20
suspected watermark           -20
heavy recompression           -15
missing alpha                 -12
colour reduction              -10
metadata stripping             -2
generated-directory source     -5
```

The precise weights should be configurable.

## 17.3 Effective resolution

Do not use raw pixel count alone.

Calculate an effective-resolution score that considers:

* dimensions;
* probable upscaling;
* actual retained detail;
* crop completeness;
* aspect-ratio relationship;
* whether the image contains additional genuine content.

## 17.4 Format ranking

Do not assign a universal order such as PNG > JPEG > WebP.

Format preference depends on content and provenance.

Examples:

* a genuine camera JPEG may be preferable to a later PNG conversion;
* a lossless PNG may be preferable for a transparent illustration;
* a WebP derivative should not beat a source JPEG merely because WebP is newer;
* a lossless WebP may be equivalent to PNG when decoded pixels and metadata are preserved;
* AVIF should not automatically win because it is newer.

## 17.5 Explainability

Every recommendation must include positive and negative reasons.

Example:

```json
{
  "recommendedOriginalId": "img-a",
  "score": 87,
  "confidence": 0.96,
  "reasons": [
    "Contains the highest measurable genuine detail",
    "No probable upscaling detected",
    "Preserves the full uncropped composition",
    "Contains an embedded ICC profile",
    "Has lower blocking artefacts than two JPEG alternatives"
  ],
  "warnings": [
    "A smaller PNG candidate contains transparency not present here"
  ]
}
```

---

# 18. Phase 12: confidence calculation

The score and confidence must be separate.

Score answers:

> How suitable is this candidate as the retained original?

Confidence answers:

> How certain is the system that this recommendation is correct?

## 18.1 Confidence signals

Increase confidence when:

* all group members have strong visual similarity;
* one candidate clearly exceeds the others;
* relationships are unambiguous;
* no crop or edit conflicts exist;
* multiple comparison methods agree;
* the selected candidate has genuine additional detail.

Reduce confidence when:

* candidates have different crops;
* candidates differ in colour treatment;
* alpha differs;
* metadata conflicts;
* two candidates have similar quality scores;
* only perceptual hashes match;
* crop detection is uncertain;
* probable upscaling is uncertain;
* one candidate is corrupted.

## 18.2 Decision thresholds

Default:

```text
confidence >= 0.97
automatic recommendation eligible

0.70 <= confidence < 0.97
manual review required

confidence < 0.70
ambiguous group
```

Even high confidence must not bypass configured hard review rules.

---

# 19. Phase 13: JSON report

Generate a complete machine-readable report.

Minimum structure:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-07-31T00:00:00.000Z",
  "config": {},
  "summary": {
    "filesDiscovered": 0,
    "filesInspected": 0,
    "exactDuplicateGroups": 0,
    "visualGroups": 0,
    "manualReviewGroups": 0,
    "errors": 0
  },
  "images": [],
  "groups": [],
  "errors": []
}
```

Requirements:

* stable schema;
* JSON Schema file;
* validate report before writing;
* deterministic ordering;
* no absolute paths unless explicitly requested;
* support `--pretty` and compact output;
* include tool version;
* include configuration fingerprint;
* include repository root where safe.

---

# 20. Phase 14: HTML review report

Create a static report for manual review.

## 20.1 Group overview

Display:

* group identifier;
* status;
* confidence;
* recommended original;
* member count;
* warning indicators;
* relationship summary.

## 20.2 Comparison view

For each image:

* thumbnail;
* path;
* format;
* dimensions;
* aspect ratio;
* file size;
* SHA-256 abbreviation;
* metadata indicators;
* quality score;
* probable upscale status;
* crop status;
* compression score;
* selected or rejected status.

## 20.3 Detail inspection

Generate comparable detail crops.

Select several crop regions:

* centre;
* strongest edge region;
* highest-detail region;
* optional face region only if implemented without external AI.

Show all candidate crops at equal displayed dimensions.

Include:

* 100% pixel view;
* normalised view;
* optional difference view;
* alpha preview.

## 20.4 Interaction

The static report should allow:

* approve recommended image;
* choose another candidate;
* keep multiple;
* mark images as unrelated;
* defer decision;
* enter a note;
* filter by confidence;
* filter by relationship;
* show only unresolved groups;
* export decisions as JSON.

The report does not need a server. Decisions may be downloaded as a JSON file and imported through the CLI.

Optional later enhancement: run a local review server that writes decisions directly.

---

# 21. Phase 15: review import and validation

Implement:

```bash
image-origin review import \
  --workspace ./.image-origin \
  --decisions ./decisions.json
```

Validate:

* group IDs exist;
* selected image belongs to the group;
* action is valid;
* no conflicting duplicate decisions;
* schema version is supported;
* source audit has not changed unexpectedly.

Reject stale decisions when group membership has changed.

Provide a `--force-stale-decisions` override, but report the risk prominently.

---

# 22. Phase 16: canonical path planning

Before copying files, generate a plan.

## 22.1 Naming strategies

Support:

* original filename;
* sanitised original filename;
* content hash;
* date and slug;
* group ID;
* configurable template.

Example:

```js
naming: {
  strategy: "template",
  template: "{year}/{slug}-{shortHash}.{ext}",
}
```

## 22.2 Filename rules

* preserve original extension by default;
* do not silently convert the selected original;
* sanitise unsafe characters;
* avoid case-insensitive collisions;
* detect Unicode-normalisation collisions;
* preserve meaningful names where possible;
* append a short hash where collision risk exists.

## 22.3 Date selection

For date-based paths, use this order:

1. trusted capture date;
2. trusted embedded metadata date;
3. configured source date;
4. filesystem date only as a weak fallback;
5. `unknown-date`.

Do not silently treat filesystem modification time as capture date.

## 22.4 Collision policy

Support:

* fail;
* append hash;
* reuse identical content;
* manual review.

Default to `fail`.

---

# 23. Phase 17: consolidation

Consolidation must be transaction-like.

## 23.1 Default behaviour

Default to copying, not moving.

The first consolidation pass should:

1. create destination directories;
2. copy selected source;
3. fsync or otherwise ensure write completion where practical;
4. calculate destination SHA-256;
5. compare source and destination hashes;
6. write manifest preview;
7. record operation;
8. leave original files untouched.

## 23.2 Apply flag

Mutations require:

```bash
--apply
```

Without `--apply`, print and save a plan only.

`--yes` must not replace `--apply`. They serve different purposes:

* `--apply`: permit mutations;
* `--yes`: suppress interactive confirmation.

## 23.3 Operation journal

Record every operation:

```json
{
  "operationId": "op-123",
  "type": "copy",
  "source": "backups/image.jpg",
  "destination": "src/assets/originals/2012/image-a1b2c3.jpg",
  "sourceHash": "...",
  "destinationHash": "...",
  "status": "verified",
  "timestamp": "..."
}
```

## 23.4 Rollback

Support rollback of copied files created by a consolidation run.

Do not delete destination files during rollback unless:

* they were created by the recorded run;
* their current hash matches the recorded created hash;
* no later manifest references depend on them.

---

# 24. Phase 18: canonical manifest

Write a manifest for retained originals.

Example:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-07-31T00:00:00.000Z",
  "images": [
    {
      "id": "img_01JZLAMAI7N8W4A",
      "canonicalPath": "src/assets/originals/2014/beach-at-lamai.jpg",
      "sha256": "...",
      "width": 4288,
      "height": 2848,
      "format": "jpeg",
      "hasAlpha": false,
      "selectedFrom": [
        "backup/photos/beach.jpg",
        "public/images/beach-large.jpg",
        "public/images/beach.webp"
      ],
      "relationships": [
        {
          "path": "public/images/beach.webp",
          "type": "resize-and-recompression",
          "confidence": 0.994
        }
      ],
      "selection": {
        "method": "manual",
        "confidence": 0.98,
        "reasons": [
          "Highest genuine detail",
          "Full uncropped composition",
          "Preserves EXIF and ICC profile"
        ]
      }
    }
  ]
}
```

Requirements:

* validate against JSON Schema;
* preserve historical source paths;
* preserve relationship classifications;
* include audit tool version;
* include selected source hash;
* support later regeneration of derived images;
* do not include thumbnails or generated report assets.

---

# 25. Phase 19: source-code reference discovery

This phase must be read-only initially.

## 25.1 Search locations

Search configured source files for references to:

* exact relative paths;
* root-relative paths;
* imported assets;
* frontmatter image fields;
* Markdown images;
* HTML `src`;
* HTML `srcset`;
* CSS `url(...)`;
* Astro imports;
* JavaScript and TypeScript string references;
* JSON and YAML asset values.

## 25.2 Classification

Classify found references:

* direct static path;
* source import;
* generated URL;
* srcset candidate;
* CSS reference;
* frontmatter field;
* unknown string occurrence.

## 25.3 Safety

Do not replace:

* partial filename matches;
* comments unless configured;
* generated build output;
* lock files;
* minified files;
* external URLs;
* data URLs.

## 25.4 Report

For every deprecated image path, report:

```text
public/images/beach-large.jpg
  src/pages/gallery.astro:24
  src/content/posts/example.md:8
  src/styles/gallery.css:42
```

---

# 26. Phase 20: reference replacement

Implement only after reference discovery is reliable.

## 26.1 Dry run first

Generate patches without writing.

Show:

* old reference;
* new reference;
* file;
* line;
* parser or replacement method;
* confidence.

## 26.2 Structured edits

Prefer parser-aware edits where practical:

* JSON parser;
* YAML parser;
* frontmatter parser;
* Astro or TypeScript parser when needed.

Plain-text replacement may be used only when:

* the complete old path is matched;
* the replacement is unambiguous;
* the file encoding is preserved;
* a backup or patch is generated.

## 26.3 Generated asset strategy

The canonical original may not be directly public.

Support a mapping layer:

```json
{
  "canonicalOriginal": "src/assets/originals/2014/beach.jpg",
  "publicAssetId": "beach-at-lamai",
  "generatedOutputs": [
    "public/generated/beach-at-lamai-640.webp",
    "public/generated/beach-at-lamai-1280.webp"
  ]
}
```

Do not replace a responsive image URL with an inaccessible source path unless the site's asset pipeline supports it.

## 26.4 Build integration

Provide hooks for repository-specific generation:

* command to generate derivatives;
* command to validate content;
* command to build;
* command to run tests.

These commands must be configurable.

---

# 27. Phase 21: verification

Verification is mandatory after consolidation or reference replacement.

## 27.1 File verification

Check:

* all canonical files exist;
* hashes match the manifest;
* dimensions match;
* formats match;
* files decode successfully;
* no destination collisions occurred;
* no canonical file is stored inside the generated-assets directory.

## 27.2 Reference verification

Check:

* all replaced references resolve;
* no removed path remains referenced;
* no reference points outside allowed roots;
* srcset entries remain valid;
* imports remain syntactically valid.

## 27.3 Repository checks

Run configured commands:

```js
checks: [
  "npm run lint",
  "npm run typecheck",
  "npm test",
  "npm run build",
]
```

Capture:

* exit code;
* stdout;
* stderr;
* duration;
* whether failure existed before changes, where baseline comparison is available.

## 27.4 Final report

Report:

* originals copied;
* references changed;
* unresolved groups;
* remaining legacy references;
* failed checks;
* warnings;
* rollback command.

---

# 28. Phase 22: cleanup planning

Do not automatically delete rejected or derived files in the initial version.

Generate a cleanup plan containing:

* exact duplicates safe to remove;
* generated derivatives that can be recreated;
* deprecated paths no longer referenced;
* files still referenced;
* uncertain files;
* files outside source control;
* estimated storage recovered.

Example command:

```bash
image-origin cleanup-plan \
  --workspace ./.image-origin \
  --output ./.image-origin/cleanup-plan.json
```

Any later delete command must require:

```bash
--apply --confirm-delete
```

Deletion must not be implemented until the rest of the workflow is stable and tested.

---

# 29. Logging and CLI output

## 29.1 Output levels

Support:

* quiet
* normal
* verbose
* debug
* JSON

## 29.2 Friendly output

Normal output should show progress by phase:

```text
Discovery
  Found 12,438 candidate files
  Ignored 1,204 generated files
  Found 8 unreadable files

Inventory
  Inspected 12,430 images
  Reused 10,912 cached records

Matching
  Found 286 exact duplicate groups
  Found 714 probable derivative groups
  Flagged 93 groups for manual review
```

## 29.3 Error handling

Errors must include:

* phase;
* file path;
* operation;
* underlying error;
* whether processing continued;
* remediation suggestion where possible.

Never swallow image-decoding errors.

At the end, exit with:

* `0`: completed without material issues;
* `1`: command failed;
* `2`: completed with review-required findings;
* `3`: verification failed;
* `4`: invalid configuration;
* `5`: unsafe operation refused.

Document exit codes.

---

# 30. Performance requirements

The system should be designed for large historical repositories.

## 30.1 Required optimisations

* cache metadata and hashes;
* stream SHA-256 calculation;
* bound image-decoding concurrency;
* avoid holding full-resolution images in memory unnecessarily;
* use normalised thumbnails for broad comparisons;
* reserve full-resolution comparisons for final candidates;
* avoid all-pairs comparison;
* persist candidate indexes;
* support resumable scans;
* provide progress reporting.

## 30.2 Memory safety

Implement configurable limits:

```js
limits: {
  maxInputPixels: 100_000_000,
  maxDecodeMemoryMb: 1024,
  maxConcurrentDecodes: 4,
  skipImagesLargerThanMb: 500,
}
```

For unusually large files:

* report them;
* inspect metadata without full decode where possible;
* require an override for expensive analysis.

---

# 31. Security requirements

Treat image files as untrusted input.

Requirements:

* use current image-decoding dependencies;
* impose pixel limits;
* impose file-size limits;
* avoid shell interpolation;
* avoid executing metadata;
* normalise paths;
* prevent path traversal;
* never write outside configured workspace or originals directory;
* reject unsafe destination templates;
* escape all report content;
* apply a restrictive Content Security Policy to the generated HTML report where practical;
* do not load external scripts or fonts in the report;
* do not make network requests.

---

# 32. Test strategy

## 32.1 Unit tests

Test:

* hash calculation;
* path normalisation;
* configuration validation;
* aspect-ratio comparison;
* relationship classification;
* scoring;
* confidence calculation;
* collision handling;
* manifest validation;
* stale review detection.

## 32.2 Integration tests

Create fixture sets representing:

* exact duplicate;
* renamed duplicate;
* metadata-only difference;
* JPEG to WebP conversion;
* JPEG resize;
* repeated JPEG recompression;
* PNG transparency loss;
* genuine high-resolution original;
* fake upscaled image;
* central crop;
* off-centre crop;
* added border;
* rotated image;
* mirrored image;
* colour-corrected version;
* watermarked version;
* unrelated but visually similar image;
* corrupted image.

## 32.3 End-to-end tests

Test complete workflows:

1. audit fixtures;
2. generate report;
3. import review decisions;
4. create consolidation plan;
5. apply consolidation into a temporary directory;
6. verify manifest and hashes;
7. discover references;
8. apply safe replacements;
9. run verification;
10. rollback copied originals.

## 32.4 Snapshot tests

Use snapshots for:

* JSON report structure;
* CLI output;
* explanations;
* manifest output;
* cleanup plans.

Avoid snapshots for unstable floating-point values unless rounded.

---

# 33. Documentation requirements

Create:

## `README.md`

Include:

* purpose;
* installation;
* quick start;
* command examples;
* safety model;
* supported formats;
* known limitations.

## `docs/architecture.md`

Explain:

* pipeline;
* data model;
* candidate generation;
* grouping;
* persistence;
* consolidation.

## `docs/scoring.md`

Document:

* all score components;
* penalties;
* confidence calculation;
* examples;
* false-positive risks.

## `docs/workflow.md`

Document:

* audit;
* review;
* consolidation;
* reference migration;
* verification;
* cleanup planning.

## `docs/limitations.md`

Explicitly state that the tool cannot reliably determine:

* historical provenance;
* copyright ownership;
* whether an edit is artistically preferable;
* whether a larger image is genuine in every case;
* whether metadata is trustworthy;
* whether two crops serve the same editorial purpose.

---

# 34. Implementation order

Execute the work in the following order.

## Milestone 1: project foundation

* initialise package;
* configure TypeScript;
* configure Biome;
* configure Vitest;
* add CLI skeleton;
* add configuration loader;
* add logging and exit codes;
* add basic documentation.

Acceptance criteria:

* CLI runs;
* configuration validates;
* tests and lint pass;
* all commands show help.

## Milestone 2: discovery and inventory

* file discovery;
* format validation;
* metadata extraction;
* SHA-256 hashing;
* SQLite storage;
* cache invalidation;
* resumable scan.

Acceptance criteria:

* scans fixture tree;
* records all expected metadata;
* reuses unchanged records;
* reports corrupt files without aborting.

## Milestone 3: exact duplicates

* exact grouping;
* duplicate report;
* deterministic group IDs;
* storage-waste metrics.

Acceptance criteria:

* all exact fixture groups detected;
* no false exact groups;
* report validates against schema.

## Milestone 4: perceptual matching

* pHash or equivalent;
* dHash or equivalent;
* candidate index;
* aspect-ratio filtering;
* initial similarity thresholds.

Acceptance criteria:

* resized and converted fixtures become candidates;
* unrelated fixtures are not broadly grouped;
* processing avoids all-pairs comparison.

## Milestone 5: confirmation and relationship classification

* SSIM;
* multi-scale comparison;
* alpha comparison;
* rotation checks;
* relationship classifier.

Acceptance criteria:

* resize, conversion, recompression, and rotation fixtures classified correctly;
* uncertain pairs are labelled rather than forced.

## Milestone 6: crop and upscale detection

* conservative crop detection;
* effective-detail comparison;
* probable upscale detection;
* corresponding warnings and penalties.

Acceptance criteria:

* known crop fixtures are detected;
* known upscale fixture loses against genuine smaller source;
* no automatic deletion or rejection occurs.

## Milestone 7: scoring and recommendations

* quality score;
* confidence score;
* explanation generator;
* hard review rules;
* group recommendations.

Acceptance criteria:

* genuine source fixtures rank above derivatives;
* recommendations include reasons;
* ambiguous groups require manual review.

## Milestone 8: reports

* JSON report;
* thumbnails;
* detail crops;
* static HTML report;
* decision export.

Acceptance criteria:

* report is usable without network access;
* decisions can be exported;
* all content is escaped;
* unresolved groups are filterable.

## Milestone 9: review import

* decision schema;
* import validation;
* stale decision handling;
* review status persistence.

Acceptance criteria:

* valid decisions apply;
* invalid selections are rejected;
* stale decisions are detected.

## Milestone 10: consolidation

* path planner;
* manifest preview;
* dry-run;
* copy;
* hash verification;
* journal;
* rollback.

Acceptance criteria:

* no mutation without `--apply`;
* copied files match source hashes;
* collisions fail safely;
* rollback removes only files created by the run.

## Milestone 11: reference discovery

* source-file scanner;
* exact path matching;
* reference classification;
* report generation.

Acceptance criteria:

* fixture references are found with file and line;
* external URLs and partial matches are ignored.

## Milestone 12: reference replacement and verification

* safe replacements;
* patch output;
* configured checks;
* final verification report.

Acceptance criteria:

* dry-run shows exact patches;
* applied references resolve;
* repository checks run;
* failures produce non-zero exit codes.

---

# 35. Coding rules for the assistant

While implementing:

* work in small, reviewable commits;
* do not implement deletion in the first version;
* do not introduce AI or remote services;
* do not send image data over the network;
* do not use filename similarity as primary visual evidence;
* do not treat perceptual hashes as conclusive;
* do not select a source based only on file dimensions;
* do not select a source based only on file size;
* do not rewrite selected originals;
* do not strip metadata from retained originals;
* do not convert the retained original during consolidation;
* do not mutate files without `--apply`;
* do not continue after destination hash verification fails;
* do not hide ambiguity from the user;
* prefer an explicit `manual-review` result over a confident but unsupported guess.

For every major module:

1. define domain types;
2. implement pure logic separately from I/O;
3. add unit tests;
4. add fixture-based integration tests;
5. expose structured errors;
6. document assumptions.

---

# 36. Required command help

Every command must support `--help`.

Example:

```text
Usage: image-origin audit [options]

Scan image directories, calculate image fingerprints, detect related files,
and produce source-quality recommendations.

Options:
  --config <path>       Configuration file
  --input <path>        Input directory; repeatable
  --workspace <path>    Audit workspace
  --force               Recalculate cached records
  --non-interactive     Disable prompts
  --format <format>     Output format: text or json
  --verbose             Show additional processing information
  --debug               Show diagnostic information
  --help                Show command help
```

Error messages must include the corrective action where practical.

---

# 37. Definition of done

The initial version is complete when it can:

1. scan a repository and backup folders;
2. inventory supported image files;
3. find exact duplicates;
4. find resized and converted visual derivatives;
5. distinguish ordinary derivatives from probable crops;
6. detect probable upscaled candidates;
7. rank likely originals using multiple quality signals;
8. explain each recommendation;
9. require manual review for ambiguous groups;
10. generate JSON and static HTML reports;
11. import review decisions;
12. copy approved originals to a canonical directory;
13. verify copied bytes with SHA-256;
14. write a provenance manifest;
15. find source-code references to deprecated paths;
16. produce safe reference-replacement patches;
17. run configured repository checks;
18. provide a rollback path;
19. leave all rejected source files untouched;
20. pass lint, type checks, unit tests, integration tests, and end-to-end tests.

---

# 38. Initial execution instruction for the coding assistant

Start by inspecting the repository and identifying its existing:

* Node.js version;
* package manager;
* TypeScript configuration;
* linting;
* testing;
* CLI conventions;
* logging conventions;
* repository instruction files;
* existing image tooling;
* asset directories;
* build commands.

Then produce a brief implementation note describing:

* which parts of this plan fit the repository unchanged;
* which parts require adaptation;
* the proposed package and directory placement;
* dependencies to add;
* the first milestone to implement.

After that, implement Milestone 1 and Milestone 2 only.

Do not proceed to perceptual matching until:

* discovery is deterministic;
* metadata extraction is tested;
* SHA-256 hashing is correct;
* SQLite persistence is stable;
* interrupted scans can resume;
* fixture-based integration tests pass.

At the end of each milestone:

* run lint;
* run type checks;
* run tests;
* run the CLI against fixtures;
* report changed files;
* report commands executed;
* report remaining limitations;
* update the implementation checklist.
