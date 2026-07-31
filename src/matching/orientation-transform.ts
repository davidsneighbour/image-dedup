import type { Sharp } from "sharp";

export type OrientationTransform = "none" | "rotate180" | "flipHorizontal" | "flipVertical";

export const ORIENTATION_TRANSFORMS: readonly OrientationTransform[] = [
  "rotate180",
  "flipHorizontal",
  "flipVertical",
];

export function applyTransform(image: Sharp, transform: OrientationTransform): Sharp {
  switch (transform) {
    case "none":
      return image;
    case "rotate180":
      return image.rotate(180);
    case "flipHorizontal":
      return image.flop();
    case "flipVertical":
      return image.flip();
  }
}
