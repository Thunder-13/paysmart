/**
 * Splits a chat or listing into lines and marks the lines that carry a tactic's quote, so the page
 * can highlight them. Pure, safe for client components.
 */
import type { TacticId } from "./taxonomy";
import { lines, normalize } from "./text";

export interface MarkedLine {
  index: number;
  text: string;
  tactics: TacticId[];
}

export function markLines(text: string | null | undefined, tactics: { id: TacticId; quote: string }[]): MarkedLine[] {
  const quotes = tactics.map((t) => ({ id: t.id, q: normalize(t.quote) })).filter((t) => t.q !== "");
  return lines(text).map((line, index) => {
    const l = normalize(line);
    // A quote inside the line, or a line inside a multi-line quote (long enough not to be noise).
    const hits = quotes.filter(({ q }) => l.includes(q) || (l.length >= 12 && q.includes(l))).map(({ id }) => id);
    return { index, text: line, tactics: [...new Set(hits)] };
  });
}
