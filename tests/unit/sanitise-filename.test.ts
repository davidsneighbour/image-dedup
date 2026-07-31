import { describe, expect, it } from "vitest";
import {
  appendSuffixToBasename,
  collisionKey,
  sanitiseFilenameComponent,
  slugify,
} from "../../src/consolidation/sanitise-filename.js";

describe("sanitiseFilenameComponent", () => {
  it("replaces unsafe characters with a hyphen", () => {
    expect(sanitiseFilenameComponent('a<b>c:d"e/f\\g|h?i*j')).toBe("a-b-c-d-e-f-g-h-i-j");
  });

  it("strips control characters", () => {
    expect(sanitiseFilenameComponent("abc")).toBe("a-b-c");
  });

  it("trims trailing dots and spaces (rejected by Windows)", () => {
    expect(sanitiseFilenameComponent("photo. ")).toBe("photo");
  });

  it("falls back to a placeholder for an empty result", () => {
    expect(sanitiseFilenameComponent("   ")).toBe("untitled");
  });

  it("leaves an already-safe name untouched", () => {
    expect(sanitiseFilenameComponent("beach-at-lamai_2014")).toBe("beach-at-lamai_2014");
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Beach At Lamai")).toBe("beach-at-lamai");
  });

  it("strips diacritics", () => {
    // "café münchen" == "café münchen"
    expect(slugify("café münchen")).toBe("cafe-munchen");
  });

  it("collapses non-alphanumeric runs and trims edge hyphens", () => {
    expect(slugify("__Photo!!  (final)__")).toBe("photo-final");
  });

  it("falls back to a placeholder when nothing alphanumeric remains", () => {
    expect(slugify("???")).toBe("image");
  });
});

describe("collisionKey", () => {
  it("is case-insensitive", () => {
    expect(collisionKey("Photo.JPG")).toBe(collisionKey("photo.jpg"));
  });

  it("is insensitive to Unicode normalisation form", () => {
    const nfc = "café.jpg"; // e-acute as one precomposed codepoint (NFC)
    const nfd = "café.jpg"; // plain "e" + combining acute accent (NFD)
    expect(nfc).not.toBe(nfd); // sanity check: distinct byte sequences...
    expect(collisionKey(nfc)).toBe(collisionKey(nfd)); // ...but the same collision key
  });

  it("normalises path separators", () => {
    expect(collisionKey("2014\\photo.jpg")).toBe(collisionKey("2014/photo.jpg"));
  });
});

describe("appendSuffixToBasename", () => {
  it("inserts the suffix before the extension", () => {
    expect(appendSuffixToBasename("2014/photo.jpg", "a1b2c3")).toBe("2014/photo-a1b2c3.jpg");
  });

  it("appends the suffix when there is no extension", () => {
    expect(appendSuffixToBasename("photo", "a1b2c3")).toBe("photo-a1b2c3");
  });

  it("only touches the last path segment", () => {
    expect(appendSuffixToBasename("a.b/c.d/photo.jpg", "hash")).toBe("a.b/c.d/photo-hash.jpg");
  });
});
