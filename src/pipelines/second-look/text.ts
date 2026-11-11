/** Small pure text helpers shared by detectors, quote checks and highlighting. */

/** Lower-case, collapse whitespace, unify curly quotes. Used for quote matching. */
export function normalize(text: string): string {
  return text
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Non-empty trimmed lines. */
export function lines(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

/** First non-empty line, cut to `max` characters. */
export function titleOf(listingText: string, max = 80): string {
  const first = lines(listingText)[0] ?? "the item";
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

/** True when `quote` appears in any of the texts (normalized substring match). */
export function quoteFound(quote: string, texts: (string | null | undefined)[]): boolean {
  const q = normalize(quote);
  if (q === "") return false;
  return texts.some((t) => !!t && normalize(t).includes(q));
}
