import sharp from "sharp";

/** dHash: (DHASH_SIZE+1) x DHASH_SIZE greyscale grid, 64 bits from horizontal gradients. */
const DHASH_SIZE = 8;
/** pHash: PHASH_SIZE x PHASH_SIZE greyscale grid fed into a 2D DCT-II; top-left 8x8 low-frequency block is kept. */
const PHASH_SIZE = 32;
const PHASH_KEEP = 8;

const POPCOUNT_NIBBLE = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

function bitsToHex(bits: string): string {
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    hex += Number.parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

/**
 * Hamming distance between two equal-length hex-encoded bit strings, as
 * produced by `computeDifferenceHash`/`computePerceptualHash`.
 */
export function hammingDistanceHex(a: string, b: string): number {
  if (a.length !== b.length) {
    throw new Error(`hash length mismatch: ${a.length} vs ${b.length}`);
  }
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    const x = Number.parseInt(a[i] ?? "0", 16) ^ Number.parseInt(b[i] ?? "0", 16);
    distance += POPCOUNT_NIBBLE[x] ?? 0;
  }
  return distance;
}

/**
 * Difference hash (dHash): resizes to a 9x8 greyscale grid and records, for
 * each row, whether each pixel is darker than its right-hand neighbour.
 * Cheap, and robust to resizing/recompression; weaker against rotation and
 * mirroring than pHash. Returns a 64-bit hash as 16 hex characters.
 */
export async function computeDifferenceHash(path: string): Promise<string> {
  const width = DHASH_SIZE + 1;
  const height = DHASH_SIZE;
  const { data } = await sharp(path)
    .greyscale()
    .resize(width, height, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let bits = "";
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < DHASH_SIZE; x++) {
      const left = data[y * width + x] ?? 0;
      const right = data[y * width + x + 1] ?? 0;
      bits += left < right ? "1" : "0";
    }
  }
  return bitsToHex(bits);
}

// Precomputed DCT-II basis for a fixed N=PHASH_SIZE, so computing a hash is
// a matrix multiply rather than repeated `Math.cos` calls per image.
const DCT_BASIS: number[][] = Array.from({ length: PHASH_SIZE }, (_, k) =>
  Array.from({ length: PHASH_SIZE }, (_, n) => Math.cos((Math.PI / PHASH_SIZE) * (n + 0.5) * k)),
);
const DCT_SCALE: number[] = Array.from({ length: PHASH_SIZE }, (_, k) =>
  k === 0 ? Math.sqrt(1 / PHASH_SIZE) : Math.sqrt(2 / PHASH_SIZE),
);

function dct1d(input: readonly number[]): number[] {
  const output = new Array<number>(PHASH_SIZE).fill(0);
  for (let k = 0; k < PHASH_SIZE; k++) {
    let sum = 0;
    const basisRow = DCT_BASIS[k] ?? [];
    for (let n = 0; n < PHASH_SIZE; n++) {
      sum += (input[n] ?? 0) * (basisRow[n] ?? 0);
    }
    output[k] = (DCT_SCALE[k] ?? 0) * sum;
  }
  return output;
}

function dct2d(matrix: readonly (readonly number[])[]): number[][] {
  const rowsTransformed = matrix.map((row) => dct1d(row));
  const result: number[][] = Array.from({ length: PHASH_SIZE }, () =>
    new Array(PHASH_SIZE).fill(0),
  );
  for (let x = 0; x < PHASH_SIZE; x++) {
    const column = rowsTransformed.map((row) => row[x] ?? 0);
    const transformedColumn = dct1d(column);
    for (let y = 0; y < PHASH_SIZE; y++) {
      const resultRow = result[y];
      if (resultRow) {
        resultRow[x] = transformedColumn[y] ?? 0;
      }
    }
  }
  return result;
}

/**
 * Perceptual hash (pHash): resizes to a 32x32 greyscale grid, applies a 2D
 * DCT-II, and keeps the top-left 8x8 low-frequency block (excluding the
 * lowest frequencies is deliberately *not* done here — the whole block,
 * including the DC term, is thresholded against its own median so the
 * result stays a self-consistent 64-bit hash). More robust to resizing,
 * recompression, and minor colour shifts than dHash. Returns a 64-bit hash
 * as 16 hex characters.
 */
export async function computePerceptualHash(path: string): Promise<string> {
  const { data } = await sharp(path)
    .greyscale()
    .resize(PHASH_SIZE, PHASH_SIZE, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const matrix: number[][] = [];
  for (let y = 0; y < PHASH_SIZE; y++) {
    const row: number[] = [];
    for (let x = 0; x < PHASH_SIZE; x++) {
      row.push(data[y * PHASH_SIZE + x] ?? 0);
    }
    matrix.push(row);
  }

  const dct = dct2d(matrix);

  const block: number[] = [];
  for (let y = 0; y < PHASH_KEEP; y++) {
    for (let x = 0; x < PHASH_KEEP; x++) {
      block.push(dct[y]?.[x] ?? 0);
    }
  }

  const sorted = [...block].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  const median =
    sorted.length % 2 === 0
      ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
      : (sorted[mid] ?? 0);

  let bits = "";
  for (const value of block) {
    bits += value > median ? "1" : "0";
  }
  return bitsToHex(bits);
}
