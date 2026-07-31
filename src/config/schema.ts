import { z } from "zod";

/**
 * Configuration schema. See PLAN.md §4 for the authoritative shape and
 * defaults. Defaults are intentionally conservative: nothing here can
 * enable a destructive action on its own — mutating commands additionally
 * require an explicit `--apply` CLI flag (PLAN.md §23.2, §35).
 */

const pathPreferenceSchema = z.object({
  pattern: z.string().min(1),
  weight: z.number(),
});

const matchingSchema = z
  .object({
    exactHash: z.boolean().default(true),
    perceptualHash: z.boolean().default(true),
    perceptualDistanceThreshold: z.number().int().nonnegative().default(10),
    ssimThreshold: z.number().min(0).max(1).default(0.96),
    aspectRatioTolerance: z.number().min(0).max(1).default(0.015),
    detectCrops: z.boolean().default(true),
    detectRotation: z.boolean().default(true),
  })
  .default({});

const qualitySchema = z
  .object({
    detectUpscaling: z.boolean().default(true),
    detectCompressionArtifacts: z.boolean().default(true),
    inspectMetadata: z.boolean().default(true),
    preserveColourProfiles: z.boolean().default(true),
    preferLosslessWhenSourceEquivalent: z.boolean().default(true),
  })
  .default({});

const reviewSchema = z
  .object({
    automaticConfidenceThreshold: z.number().min(0).max(1).default(0.97),
    manualReviewThreshold: z.number().min(0).max(1).default(0.7),
    neverAutoSelectCrops: z.boolean().default(true),
    neverAutoSelectEditedVariants: z.boolean().default(true),
  })
  .default({})
  .superRefine((review, ctx) => {
    if (review.manualReviewThreshold > review.automaticConfidenceThreshold) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "review.manualReviewThreshold must not exceed review.automaticConfidenceThreshold",
        path: ["manualReviewThreshold"],
      });
    }
  });

const consolidationSchema = z
  .object({
    naming: z
      .enum([
        "original-filename",
        "sanitised-filename",
        "content-hash",
        "date-slug",
        "group-id",
        "template",
      ])
      .default("content-hash"),
    template: z.string().optional(),
    preserveExtension: z.boolean().default(true),
    copyInsteadOfMove: z.boolean().default(true),
    collisionPolicy: z
      .enum(["fail", "append-hash", "reuse-identical", "manual-review"])
      .default("fail"),
    writeManifest: z.boolean().default(true),
  })
  .default({})
  .superRefine((consolidation, ctx) => {
    if (consolidation.naming === "template" && !consolidation.template) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'consolidation.template is required when consolidation.naming is "template"',
        path: ["template"],
      });
    }
    if (!consolidation.copyInsteadOfMove) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "consolidation.copyInsteadOfMove must not be disabled: moving (deleting) sources is not supported in this version",
        path: ["copyInsteadOfMove"],
      });
    }
  });

const referencesSchema = z
  .object({
    enabled: z.boolean().default(true),
    sourceExtensions: z
      .array(z.string().regex(/^\.[a-z0-9]+$/i, 'must be a dotted extension, e.g. ".astro"'))
      .default([
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
      ]),
  })
  .default({});

const discoverySchema = z
  .object({
    followSymlinks: z.boolean().default(true),
  })
  .default({});

const concurrencySchema = z
  .object({
    discovery: z.number().int().positive().default(16),
    metadata: z.number().int().positive().default(8),
    decoding: z.number().int().positive().default(4),
    comparison: z.number().int().positive().default(2),
  })
  .default({});

const limitsSchema = z
  .object({
    maxInputPixels: z.number().int().positive().default(100_000_000),
    maxDecodeMemoryMb: z.number().int().positive().default(1024),
    maxConcurrentDecodes: z.number().int().positive().default(4),
    skipImagesLargerThanMb: z.number().int().positive().default(500),
  })
  .default({});

export const configSchema = z
  .object({
    inputs: z.array(z.string().min(1)).min(1, "at least one input directory is required"),
    workspace: z.string().min(1).default("./.image-origin"),
    originalsDirectory: z.string().min(1).optional(),

    include: z.array(z.string()).default(["**/*.{jpg,jpeg,png,webp,avif,gif}"]),
    exclude: z
      .array(z.string())
      .default([
        "**/node_modules/**",
        "**/.git/**",
        "**/.cache/**",
        "**/dist/**",
        "**/.image-origin/**",
      ]),

    pathPreferences: z.array(pathPreferenceSchema).default([]),

    discovery: discoverySchema,
    matching: matchingSchema,
    quality: qualitySchema,
    review: reviewSchema,
    consolidation: consolidationSchema,
    references: referencesSchema,
    concurrency: concurrencySchema,
    limits: limitsSchema,

    checks: z.array(z.string()).default([]),
  })
  .strict();

export type ImageOriginConfig = z.infer<typeof configSchema>;

/** Input shape before defaults are applied — used for `--help`/docs generation and CLI overrides. */
export type ImageOriginConfigInput = z.input<typeof configSchema>;
