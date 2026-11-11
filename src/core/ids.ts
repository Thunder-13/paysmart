/** Url-safe random ids: newId("slip") -> "slip_8f3k2q0x7c1m9d4a". Works in Node and the browser. */
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function randomToken(length = 16, alphabet = ALPHABET): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  // 256 % 36 != 0, so reject the biased tail to keep the distribution flat.
  const limit = 256 - (256 % alphabet.length);
  let i = 0;
  while (out.length < length) {
    if (i >= bytes.length) {
      globalThis.crypto.getRandomValues(bytes);
      i = 0;
    }
    const b = bytes[i++];
    if (b < limit) out += alphabet[b % alphabet.length];
  }
  return out;
}

export function newId(prefix: string): string {
  return `${prefix}_${randomToken(16)}`;
}
