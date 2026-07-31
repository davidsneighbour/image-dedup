import { describe, expect, it } from "vitest";
import { parseExif } from "../../src/inventory/exif.js";

/** Builds a minimal little-endian TIFF/EXIF block with only IFD0 ASCII tags. */
function buildTinyExif(fields: { make?: string; model?: string }): Buffer {
  const entries: { tag: number; value: string }[] = [];
  if (fields.make) entries.push({ tag: 0x010f, value: fields.make });
  if (fields.model) entries.push({ tag: 0x0110, value: fields.model });

  const ifd0Offset = 8;
  const entryCount = entries.length;
  const bufferLength = ifd0Offset + 2 + entryCount * 12 + 4;
  const buffer = Buffer.alloc(bufferLength);

  buffer.write("II", 0, "ascii");
  buffer.writeUInt16LE(0x002a, 2);
  buffer.writeUInt32LE(ifd0Offset, 4);
  buffer.writeUInt16LE(entryCount, ifd0Offset);

  entries.forEach((entry, index) => {
    const entryOffset = ifd0Offset + 2 + index * 12;
    const asciiValue = `${entry.value}\0`;
    buffer.writeUInt16LE(entry.tag, entryOffset);
    buffer.writeUInt16LE(2, entryOffset + 2); // type: ASCII
    buffer.writeUInt32LE(asciiValue.length, entryOffset + 4);
    if (asciiValue.length > 4) {
      throw new Error("test helper only supports inline (<=4 byte) ASCII values");
    }
    buffer.write(asciiValue, entryOffset + 8, "ascii");
  });

  buffer.writeUInt32LE(0, ifd0Offset + 2 + entryCount * 12); // next IFD offset

  return buffer;
}

describe("parseExif", () => {
  it("reads Make and Model ASCII tags from IFD0", () => {
    const buffer = buildTinyExif({ make: "AB", model: "CD" });
    const result = parseExif(buffer);
    expect(result.cameraMake).toBe("AB");
    expect(result.cameraModel).toBe("CD");
  });

  it("returns an empty result for a non-TIFF buffer instead of throwing", () => {
    expect(parseExif(Buffer.from("not exif data"))).toEqual({});
  });

  it("returns an empty result for a truncated buffer instead of throwing", () => {
    expect(parseExif(Buffer.alloc(3))).toEqual({});
  });

  it("returns an empty result when no recognised tags are present", () => {
    const buffer = buildTinyExif({});
    expect(parseExif(buffer)).toEqual({});
  });
});
