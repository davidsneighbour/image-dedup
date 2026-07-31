/**
 * Core per-file record. See PLAN.md §5.1.
 *
 * M2 (discovery + inventory) populates `file`, `image`, `metadata`,
 * `hashes.sha256`, and `warnings`. `hashes.perceptual`/`hashes.difference`
 * are filled in by matching (M4); `quality.*` is filled in by analysis
 * (M6/M7). They are typed here now so downstream phases don't need to
 * change this shape.
 */
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
