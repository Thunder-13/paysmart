/**
 * Difference hash (dHash): downscale a photo to 9x8 grayscale, compare each pixel with its right
 * neighbor, pack the 64 bits into 16 hex chars (one byte per row, most significant bit first).
 * Pure, so the browser (canvas pixels) and the tests (fixture pixels) share it.
 */
/** Hamming distance at or below which 2 photos count as the same picture. */
export const NEAR_DUPLICATE_BITS = 5;
export const DHASH_WIDTH = 9;
export const DHASH_HEIGHT = 8;
const HEX_RE = /^[0-9a-f]{16}$/;

/** gray: 72 luma values (0..255), row-major, 9 wide and 8 tall. */
export function dHashFromGray(gray: ArrayLike<number>): string {
  if (gray.length !== DHASH_WIDTH * DHASH_HEIGHT) {
    throw new Error(`dHash needs ${DHASH_WIDTH * DHASH_HEIGHT} gray values, got ${gray.length}`);
  }
  let hex = "";
  for (let row = 0; row < DHASH_HEIGHT; row++) {
    let byte = 0;
    for (let col = 0; col < DHASH_WIDTH - 1; col++) {
      const left = gray[row * DHASH_WIDTH + col];
      const right = gray[row * DHASH_WIDTH + col + 1];
      byte = (byte << 1) | (left > right ? 1 : 0);
    }
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/** Luma from RGBA bytes (canvas ImageData) using Rec. 601 weights. */
export function grayFromRgba(rgba: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    out.push(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
  }
  return out;
}

function nibbleBits(n: number): number {
  let bits = 0;
  for (let v = n; v > 0; v >>= 1) bits += v & 1;
  return bits;
}

/** Number of differing bits between 2 dHashes. Throws on anything but 16 hex chars. */
export function hamming(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (!HEX_RE.test(x) || !HEX_RE.test(y)) throw new Error(`Not a 64-bit hex hash: "${a}" / "${b}"`);
  let bits = 0;
  for (let i = 0; i < 16; i++) bits += nibbleBits(Number.parseInt(x[i], 16) ^ Number.parseInt(y[i], 16));
  return bits;
}

export function isNearDuplicate(a: string, b: string, maxBits = NEAR_DUPLICATE_BITS): boolean {
  return hamming(a, b) <= maxBits;
}
