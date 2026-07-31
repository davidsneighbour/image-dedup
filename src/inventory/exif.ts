/**
 * Minimal EXIF/TIFF tag reader for the handful of fields PLAN.md §8.1 asks
 * for (capture date, camera make/model, copyright, creator). Deliberately
 * narrow: it reads IFD0 and the Exif SubIFD only, and only ASCII-valued
 * tags. It does not attempt to be a general-purpose EXIF library.
 *
 * Malformed EXIF blocks must never abort inventory (PLAN.md §29.3 — errors
 * are recorded, not fatal); every entry point here returns an empty result
 * on any parse failure instead of throwing.
 */

const TAG_MAKE = 0x010f;
const TAG_MODEL = 0x0110;
const TAG_DATETIME = 0x0132;
const TAG_ARTIST = 0x013b;
const TAG_COPYRIGHT = 0x8298;
const TAG_EXIF_IFD_POINTER = 0x8769;
const TAG_DATETIME_ORIGINAL = 0x9003;

const TYPE_SIZES: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  7: 1, // UNDEFINED
  9: 4, // SLONG
  10: 8, // SRATIONAL
};

export interface ExifFields {
  captureDate?: string;
  cameraMake?: string;
  cameraModel?: string;
  copyright?: string;
  creator?: string;
}

function readIfd(
  buffer: Buffer,
  ifdOffset: number,
  littleEndian: boolean,
): { entries: Map<number, string>; nextIfdOffset: number } | undefined {
  if (ifdOffset + 2 > buffer.length) {
    return undefined;
  }
  const entryCount = littleEndian ? buffer.readUInt16LE(ifdOffset) : buffer.readUInt16BE(ifdOffset);
  const entries = new Map<number, string>();

  for (let i = 0; i < entryCount; i++) {
    const entryOffset = ifdOffset + 2 + i * 12;
    if (entryOffset + 12 > buffer.length) {
      break;
    }
    const tag = littleEndian ? buffer.readUInt16LE(entryOffset) : buffer.readUInt16BE(entryOffset);
    const type = littleEndian
      ? buffer.readUInt16LE(entryOffset + 2)
      : buffer.readUInt16BE(entryOffset + 2);
    const count = littleEndian
      ? buffer.readUInt32LE(entryOffset + 4)
      : buffer.readUInt32BE(entryOffset + 4);

    const typeSize = TYPE_SIZES[type];
    if (!typeSize) {
      continue;
    }
    const valueByteLength = typeSize * count;
    const valueAreaOffset = entryOffset + 8;
    const dataOffset =
      valueByteLength <= 4
        ? valueAreaOffset
        : littleEndian
          ? buffer.readUInt32LE(valueAreaOffset)
          : buffer.readUInt32BE(valueAreaOffset);

    if (type === 2 /* ASCII */) {
      if (dataOffset + count > buffer.length) {
        continue;
      }
      const raw = buffer.toString("ascii", dataOffset, dataOffset + count);
      const value = raw.replace(/\0+$/, "").trim();
      if (value) {
        entries.set(tag, value);
      }
    } else if (tag === TAG_EXIF_IFD_POINTER) {
      const pointerValue = littleEndian
        ? buffer.readUInt32LE(valueAreaOffset)
        : buffer.readUInt32BE(valueAreaOffset);
      entries.set(tag, String(pointerValue));
    }
  }

  const nextOffsetPos = ifdOffset + 2 + entryCount * 12;
  const nextIfdOffset =
    nextOffsetPos + 4 <= buffer.length
      ? littleEndian
        ? buffer.readUInt32LE(nextOffsetPos)
        : buffer.readUInt32BE(nextOffsetPos)
      : 0;

  return { entries, nextIfdOffset };
}

/** `exifBuffer` is the raw EXIF/TIFF block as returned by sharp's `metadata().exif`. */
export function parseExif(exifBuffer: Buffer): ExifFields {
  try {
    if (exifBuffer.length < 8) {
      return {};
    }
    const byteOrder = exifBuffer.toString("ascii", 0, 2);
    if (byteOrder !== "II" && byteOrder !== "MM") {
      return {};
    }
    const littleEndian = byteOrder === "II";
    const magic = littleEndian ? exifBuffer.readUInt16LE(2) : exifBuffer.readUInt16BE(2);
    if (magic !== 0x002a) {
      return {};
    }
    const ifd0Offset = littleEndian ? exifBuffer.readUInt32LE(4) : exifBuffer.readUInt32BE(4);

    const ifd0 = readIfd(exifBuffer, ifd0Offset, littleEndian);
    if (!ifd0) {
      return {};
    }

    const result: ExifFields = {};
    const make = ifd0.entries.get(TAG_MAKE);
    if (make) result.cameraMake = make;
    const model = ifd0.entries.get(TAG_MODEL);
    if (model) result.cameraModel = model;
    const copyright = ifd0.entries.get(TAG_COPYRIGHT);
    if (copyright) result.copyright = copyright;
    const artist = ifd0.entries.get(TAG_ARTIST);
    if (artist) result.creator = artist;
    const dateTime = ifd0.entries.get(TAG_DATETIME);
    if (dateTime) result.captureDate = dateTime;

    const exifIfdPointer = ifd0.entries.get(TAG_EXIF_IFD_POINTER);
    if (exifIfdPointer) {
      const exifIfd = readIfd(exifBuffer, Number(exifIfdPointer), littleEndian);
      const dateTimeOriginal = exifIfd?.entries.get(TAG_DATETIME_ORIGINAL);
      if (dateTimeOriginal) {
        result.captureDate = dateTimeOriginal;
      }
    }

    return result;
  } catch {
    return {};
  }
}
