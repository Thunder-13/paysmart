/**
 * Generates the bounty pipeline's mock photos: tiny 36x24 grayscale PNGs drawn in memory, with
 * their dHash (block-averaged to 9x8). Writes src/pipelines/bounty/fixtures.ts.
 *
 *   npx tsx scripts/bounty-fixtures.ts
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { dHashFromGray, hamming, NEAR_DUPLICATE_BITS } from "../src/pipelines/bounty/dhash";

const W = 36;
const H = 24;

type Scene = (x: number, y: number) => number;

function draw(scene: Scene): Uint8Array {
  const px = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px[y * W + x] = Math.max(0, Math.min(255, Math.round(scene(x, y))));
  return px;
}

/* ------------------------------------------------------------ scenes */

const street: Scene = (x, y) => (y < 5 ? 190 : 70 + x * 2);
const inGrate = (x: number, y: number) => x >= 8 && x < 28 && y >= 9 && y < 21;
const grate: Scene = (x, y) => (inGrate(x, y) ? (Math.floor((x - 8) / 4) % 2 === 0 ? 25 : 170) : street(x, y));
const leaves = (x: number, y: number) => ((x - 18) / 11) ** 2 + ((y - 15) / 7) ** 2 <= 1;

const drainBefore: Scene = (x, y) => (leaves(x, y) ? 120 + ((x * 7 + y * 13) % 5) * 9 - x : grate(x, y));
const drainAfter: Scene = grate;
const drainAfterCopy: Scene = (x, y) => drainAfter(x, y) + (x === 2 && y === 2 ? 6 : 0) - (x === 30 && y === 20 ? 5 : 0);

const yard: Scene = (x, y) => 235 - x * 3 + (y % 3);
const onPath = (_x: number, y: number) => y >= 8 && y < 16;
const walkBefore: Scene = (x, y) => (onPath(x, y) ? 228 - ((x * 5 + y * 3) % 4) * 6 : yard(x, y));
const walkAfter: Scene = (x, y) => (onPath(x, y) ? (x % 6 === 0 ? 40 : 95 + (x % 6) * 12) : yard(x, y));

/* --------------------------------------------------------------- png */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** 8-bit grayscale PNG, filter 0 on every row. */
export function encodeGrayPng(px: Uint8Array, width = W, height = H): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    Buffer.from(px.subarray(y * width, (y + 1) * width)).copy(raw, y * (width + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/** Average 4x3 blocks of the 36x24 image down to 9x8, then dHash. */
export function dHashOfPixels(px: Uint8Array, width = W, height = H): string {
  const bw = width / 9;
  const bh = height / 8;
  const gray: number[] = [];
  for (let by = 0; by < 8; by++) {
    for (let bx = 0; bx < 9; bx++) {
      let sum = 0;
      for (let y = by * bh; y < (by + 1) * bh; y++) for (let x = bx * bw; x < (bx + 1) * bw; x++) sum += px[y * width + x];
      gray.push(sum / (bw * bh));
    }
  }
  return dHashFromGray(gray);
}

/* -------------------------------------------------------------- main */

const SCENES = { drainBefore, drainAfter, drainAfterCopy, walkBefore, walkAfter };
type Name = keyof typeof SCENES;

function main() {
  const out = {} as Record<Name, { contentType: "image/png"; base64: string; dHash: string; bytes: number }>;
  for (const [name, scene] of Object.entries(SCENES) as [Name, Scene][]) {
    const px = draw(scene);
    const png = encodeGrayPng(px);
    if (png.length >= 1024) throw new Error(`${name} is ${png.length} bytes; fixtures must stay under 1 KB`);
    out[name] = { contentType: "image/png", base64: png.toString("base64"), dHash: dHashOfPixels(px), bytes: png.length };
  }

  const names = Object.keys(out) as Name[];
  const dupPair: [Name, Name] = ["drainAfter", "drainAfterCopy"];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const bits = hamming(out[names[i]].dHash, out[names[j]].dHash);
      const isDup = dupPair.includes(names[i]) && dupPair.includes(names[j]);
      console.log(`${names[i].padEnd(15)} ${names[j].padEnd(15)} ${String(bits).padStart(2)} bits${isDup ? "  (duplicate pair)" : ""}`);
      if (isDup && bits > NEAR_DUPLICATE_BITS) throw new Error(`duplicate pair is ${bits} bits apart; must be <= ${NEAR_DUPLICATE_BITS}`);
      if (!isDup && bits <= NEAR_DUPLICATE_BITS) throw new Error(`${names[i]} and ${names[j]} are only ${bits} bits apart`);
    }
  }

  const body = names
    .map((n) => `  ${n}: {\n    contentType: "image/png",\n    dHash: "${out[n].dHash}",\n    base64:\n      "${out[n].base64}",\n  },`)
    .join("\n");
  const file = `// GENERATED by scripts/bounty-fixtures.ts. Do not edit by hand; rerun the script.
// Tiny 36x24 grayscale PNGs for mock mode and tests. dHash is block-averaged to 9x8.

export interface PhotoFixture {
  contentType: "image/png";
  dHash: string;
  base64: string;
}

export const FIXTURES = {
${body}
} satisfies Record<string, PhotoFixture>;

export type FixtureName = keyof typeof FIXTURES;

/** Storm drain full of leaves, then clear. Passes every check in mock mode. */
export const PASSING_PAIR: [FixtureName, FixtureName] = ["drainBefore", "drainAfter"];
/** Snowy walk, then shoveled. A second fresh pair for multi-bounty tests and the demo seed. */
export const SECOND_PASSING_PAIR: [FixtureName, FixtureName] = ["walkBefore", "walkAfter"];
/** The clear drain twice (1 pixel nudged). Fails the fresh-photos check. */
export const DUPLICATE_PAIR: [FixtureName, FixtureName] = ["drainAfter", "drainAfterCopy"];
`;
  const target = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "src", "pipelines", "bounty", "fixtures.ts");
  writeFileSync(target, file);
  console.log(`wrote ${target} (${names.map((n) => `${n} ${out[n].bytes} B`).join(", ")})`);
}

if (process.argv[1] && /bounty-fixtures\.ts$/.test(process.argv[1])) main();
