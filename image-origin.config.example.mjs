/** @type {import("./src/config/schema.js").ImageOriginConfigInput} */
export default {
  inputs: ["./public", "./backups", "./legacy-assets"],

  workspace: "./.image-origin",
  originalsDirectory: "./src/assets/originals",

  include: ["**/*.{jpg,jpeg,png,webp,avif,gif}"],

  exclude: [
    "**/node_modules/**",
    "**/.git/**",
    "**/.cache/**",
    "**/dist/**",
    "**/.image-origin/**",
  ],

  discovery: {
    followSymlinks: true,
  },

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

  limits: {
    maxInputPixels: 100_000_000,
    maxDecodeMemoryMb: 1024,
    maxConcurrentDecodes: 4,
    skipImagesLargerThanMb: 500,
  },

  checks: [],
};
