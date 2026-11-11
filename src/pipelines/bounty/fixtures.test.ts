import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { dHashOfPixels } from "../../../scripts/bounty-fixtures";
import { hamming, NEAR_DUPLICATE_BITS } from "./dhash";
import { DUPLICATE_PAIR, FIXTURES, PASSING_PAIR, SECOND_PASSING_PAIR, type FixtureName } from "./fixtures";

/** Minimal decoder for our own fixtures: 8-bit grayscale, filter 0 on every row. */
function decodeGrayPng(base64: string): { width: number; height: number; px: Uint8Array } {
  const buf = Buffer.from(base64, "base64");
  expect([...buf.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let off = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    }
    if (type === "IDAT") idat.push(data);
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const px = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    expect(raw[y * (width + 1)]).toBe(0);
    px.set(raw.subarray(y * (width + 1) + 1, (y + 1) * (width + 1)), y * width);
  }
  return { width, height, px };
}

const names = Object.keys(FIXTURES) as FixtureName[];

describe("bounty fixtures", () => {
  it("are PNGs under 1 KB whose stored dHash matches the pixels", () => {
    for (const name of names) {
      const f = FIXTURES[name];
      expect(Buffer.from(f.base64, "base64").length).toBeLessThan(1024);
      const { width, height, px } = decodeGrayPng(f.base64);
      expect([width, height]).toEqual([36, 24]);
      expect(dHashOfPixels(px)).toBe(f.dHash);
    }
  });

  it("keeps passing pairs more than 5 bits apart and the duplicate pair 5 or fewer", () => {
    for (const [a, b] of [PASSING_PAIR, SECOND_PASSING_PAIR]) {
      expect(hamming(FIXTURES[a].dHash, FIXTURES[b].dHash)).toBeGreaterThan(NEAR_DUPLICATE_BITS);
    }
    expect(hamming(FIXTURES[DUPLICATE_PAIR[0]].dHash, FIXTURES[DUPLICATE_PAIR[1]].dHash)).toBeLessThanOrEqual(NEAR_DUPLICATE_BITS);
  });

  it("keeps the 2 scenes far apart", () => {
    expect(hamming(FIXTURES.drainAfter.dHash, FIXTURES.walkAfter.dHash)).toBeGreaterThan(20);
  });
});
