import { describe, expect, it } from "vitest";
import { scorePathPreference } from "../../src/matching/path-preferences.js";

describe("scorePathPreference", () => {
  it("returns 0 when no preferences are configured", () => {
    expect(scorePathPreference("backups/originals/photo.jpg", [])).toBe(0);
  });

  it("sums the weights of every matching pattern", () => {
    const preferences = [
      { pattern: "backups/originals/**", weight: 20 },
      { pattern: "**/*.jpg", weight: 5 },
    ];
    expect(scorePathPreference("backups/originals/photo.jpg", preferences)).toBe(25);
  });

  it("applies negative weights for deprioritised locations", () => {
    const preferences = [{ pattern: "public/generated/**", weight: -20 }];
    expect(scorePathPreference("public/generated/photo-640.webp", preferences)).toBe(-20);
  });

  it("scores 0 for a path matching no pattern", () => {
    const preferences = [{ pattern: "backups/originals/**", weight: 20 }];
    expect(scorePathPreference("random/photo.jpg", preferences)).toBe(0);
  });

  it("normalises Windows-style separators before matching", () => {
    const preferences = [{ pattern: "backups/originals/**", weight: 20 }];
    expect(scorePathPreference("backups\\originals\\photo.jpg", preferences)).toBe(20);
  });
});
