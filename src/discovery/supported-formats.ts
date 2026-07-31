export type SupportedFormat = "jpeg" | "png" | "webp" | "avif" | "gif";

export const SUPPORTED_EXTENSIONS: ReadonlyMap<string, SupportedFormat> = new Map([
  [".jpg", "jpeg"],
  [".jpeg", "jpeg"],
  [".png", "png"],
  [".webp", "webp"],
  [".avif", "avif"],
  [".gif", "gif"],
]);

/** Format implied by the file extension, if any. Case-insensitive. */
export function formatFromExtension(filePath: string): SupportedFormat | undefined {
  const match = /\.[^./\\]+$/.exec(filePath);
  if (!match) {
    return undefined;
  }
  return SUPPORTED_EXTENSIONS.get(match[0].toLowerCase());
}

function asciiAt(buffer: Buffer, start: number, length: number): string {
  return buffer.toString("ascii", start, start + length);
}

/**
 * Identifies a supported format from file content (magic bytes), independent
 * of the file extension. See PLAN.md §7.1 ("detect files by content where
 * extension and actual format differ").
 */
export function formatFromContent(buffer: Buffer): SupportedFormat | undefined {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpeg";
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "png";
  }

  if (buffer.length >= 12 && asciiAt(buffer, 0, 4) === "RIFF" && asciiAt(buffer, 8, 4) === "WEBP") {
    return "webp";
  }

  if (
    buffer.length >= 6 &&
    (asciiAt(buffer, 0, 6) === "GIF87a" || asciiAt(buffer, 0, 6) === "GIF89a")
  ) {
    return "gif";
  }

  if (buffer.length >= 12 && asciiAt(buffer, 4, 4) === "ftyp") {
    const brand = asciiAt(buffer, 8, 4);
    if (brand === "avif" || brand === "avis") {
      return "avif";
    }
  }

  return undefined;
}

/** Number of leading bytes sufficient to identify any supported format. */
export const MAGIC_BYTES_SNIFF_LENGTH = 16;
