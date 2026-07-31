import { describe, expect, it } from "vitest";
import { formatFromContent, formatFromExtension } from "../../src/discovery/supported-formats.js";

describe("formatFromExtension", () => {
  it("maps known extensions case-insensitively", () => {
    expect(formatFromExtension("photo.JPG")).toBe("jpeg");
    expect(formatFromExtension("photo.jpeg")).toBe("jpeg");
    expect(formatFromExtension("photo.PNG")).toBe("png");
    expect(formatFromExtension("photo.webp")).toBe("webp");
    expect(formatFromExtension("photo.AVIF")).toBe("avif");
    expect(formatFromExtension("photo.gif")).toBe("gif");
  });

  it("returns undefined for unsupported or missing extensions", () => {
    expect(formatFromExtension("notes.txt")).toBeUndefined();
    expect(formatFromExtension("no-extension")).toBeUndefined();
  });
});

describe("formatFromContent", () => {
  it("identifies JPEG by magic bytes", () => {
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(formatFromContent(buffer)).toBe("jpeg");
  });

  it("identifies PNG by magic bytes", () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(formatFromContent(buffer)).toBe("png");
  });

  it("identifies WebP by RIFF/WEBP container", () => {
    const buffer = Buffer.concat([
      Buffer.from("RIFF", "ascii"),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from("WEBP", "ascii"),
    ]);
    expect(formatFromContent(buffer)).toBe("webp");
  });

  it("identifies GIF87a and GIF89a", () => {
    expect(formatFromContent(Buffer.from("GIF87a", "ascii"))).toBe("gif");
    expect(formatFromContent(Buffer.from("GIF89a", "ascii"))).toBe("gif");
  });

  it("identifies AVIF by ftyp brand", () => {
    const buffer = Buffer.concat([
      Buffer.from([0, 0, 0, 0x1c]),
      Buffer.from("ftyp", "ascii"),
      Buffer.from("avif", "ascii"),
    ]);
    expect(formatFromContent(buffer)).toBe("avif");
  });

  it("does not misidentify an unrelated HEIC ftyp brand as AVIF", () => {
    const buffer = Buffer.concat([
      Buffer.from([0, 0, 0, 0x1c]),
      Buffer.from("ftyp", "ascii"),
      Buffer.from("heic", "ascii"),
    ]);
    expect(formatFromContent(buffer)).toBeUndefined();
  });

  it("returns undefined for arbitrary text content", () => {
    expect(formatFromContent(Buffer.from("not an image", "ascii"))).toBeUndefined();
  });
});
