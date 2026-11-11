/** PayPal caps free-text order fields such as purchase_units[].description at 127 characters. */
export const PAYPAL_TEXT_MAX = 127;

const ELLIPSIS = "…";

/**
 * Shortens text to at most `max` characters, ellipsis included, cutting at the last word boundary
 * so the buyer never sees half a word. Text that already fits comes back unchanged, so clipping
 * twice gives the same result. A single word longer than half the room is cut hard instead.
 */
export function clipText(text: string, max = PAYPAL_TEXT_MAX): string {
  if (text.length <= max) return text;
  if (max <= ELLIPSIS.length) return ELLIPSIS.slice(0, Math.max(0, max));
  const room = max - ELLIPSIS.length;
  let cut = text.slice(0, room);
  if (!/\s/.test(text.charAt(room))) {
    const lastSpace = cut.search(/\s\S*$/);
    if (lastSpace >= room / 2) cut = cut.slice(0, lastSpace);
  }
  // No dangling space, comma or full stop before the ellipsis, and never half a surrogate pair.
  cut = cut.replace(/[\s,.;:!?-]+$/u, "").replace(/[\uD800-\uDBFF]$/, "");
  return `${cut}${ELLIPSIS}`;
}
