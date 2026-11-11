import { describe, expect, it } from "vitest";
import { dHashFromGray, grayFromRgba, hamming, isNearDuplicate } from "./dhash";

function grid(rowFn: (row: number) => number[]): number[] {
  const out: number[] = [];
  for (let r = 0; r < 8; r++) out.push(...rowFn(r));
  return out;
}

describe("dHash Hamming function", () => {
  it("gives 0 for identical hashes", () => {
    expect(hamming("0123456789abcdef", "0123456789abcdef")).toBe(0);
  });

  it("counts differing bits", () => {
    expect(hamming("0000000000000000", "000000000000000f")).toBe(4);
    expect(hamming("0000000000000000", "8000000000000001")).toBe(2);
  });

  it("gives 64 for complements", () => {
    expect(hamming("0000000000000000", "ffffffffffffffff")).toBe(64);
    expect(hamming("a5a5a5a5a5a5a5a5", "5a5a5a5a5a5a5a5a")).toBe(64);
  });

  it("accepts upper case but throws on non-hex or wrong length", () => {
    expect(hamming("ABCDEF0123456789", "abcdef0123456789")).toBe(0);
    expect(() => hamming("zzzzzzzzzzzzzzzz", "0000000000000000")).toThrow(/64-bit hex/);
    expect(() => hamming("abc", "0000000000000000")).toThrow();
  });

  it("treats 5 bits as a near duplicate and 6 as different", () => {
    expect(isNearDuplicate("0000000000000000", "000000000000001f")).toBe(true);
    expect(isNearDuplicate("0000000000000000", "000000000000003f")).toBe(false);
  });
});

describe("dHashFromGray", () => {
  it("hashes a known 9x8 grid", () => {
    const down = [80, 70, 60, 50, 40, 30, 20, 10, 0];
    const up = [...down].reverse();
    expect(dHashFromGray(grid((r) => (r < 4 ? down : up)))).toBe("ffffffff00000000");
    expect(dHashFromGray(grid(() => [10, 0, 10, 0, 10, 0, 10, 0, 10]))).toBe("aaaaaaaaaaaaaaaa");
  });

  it("rejects the wrong number of pixels", () => {
    expect(() => dHashFromGray([1, 2, 3])).toThrow(/72 gray values/);
  });

  it("converts RGBA to luma", () => {
    const [white, black] = grayFromRgba([255, 255, 255, 255, 0, 0, 0, 255]);
    expect(white).toBeCloseTo(255, 5);
    expect(black).toBe(0);
  });
});
