import sharp from "sharp";
import type { ImageRecord } from "../domain/image-record.js";
import { parseExif } from "./exif.js";

const DEPTH_TO_BITS: Record<string, number> = {
  uchar: 8,
  char: 8,
  ushort: 16,
  short: 16,
  uint: 32,
  int: 32,
  float: 32,
  complex: 64,
  double: 64,
  dpcomplex: 128,
};

export interface InspectedMetadata {
  image: ImageRecord["image"];
  metadata: ImageRecord["metadata"];
}

/**
 * Extracts image + metadata fields via sharp. Reads only the header/metadata
 * (sharp does not decode full pixel data for `.metadata()`), which keeps
 * this cheap even for very large files. Throws on undecodable files — the
 * caller (inspect-image.ts) is responsible for turning that into a
 * "corrupted" record rather than aborting the whole scan.
 */
export async function inspectMetadata(
  path: string,
  maxInputPixels: number,
): Promise<InspectedMetadata> {
  const image = sharp(path, { limitInputPixels: maxInputPixels, failOn: "error" });
  const raw = await image.metadata();

  if (!raw.format || !raw.width || !raw.height) {
    throw new Error("could not determine image format or dimensions");
  }

  const exifFields = raw.exif ? parseExif(raw.exif) : {};

  return {
    image: {
      format: raw.format,
      width: raw.width,
      height: raw.height,
      aspectRatio: raw.width / raw.height,
      ...(raw.orientation !== undefined ? { orientation: raw.orientation } : {}),
      pages: raw.pages ?? 1,
      hasAlpha: raw.hasAlpha ?? false,
      ...(raw.depth && DEPTH_TO_BITS[raw.depth] !== undefined
        ? { bitDepth: DEPTH_TO_BITS[raw.depth] }
        : {}),
      ...(raw.channels !== undefined ? { channels: raw.channels } : {}),
      ...(raw.space !== undefined ? { colourSpace: raw.space } : {}),
      ...(raw.density !== undefined ? { density: raw.density } : {}),
    },
    metadata: {
      exifPresent: raw.exif !== undefined,
      iptcPresent: raw.iptc !== undefined,
      xmpPresent: raw.xmp !== undefined,
      iccPresent: raw.icc !== undefined,
      ...exifFields,
    },
  };
}
