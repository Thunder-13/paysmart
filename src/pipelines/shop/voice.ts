/**
 * Talk to Pay: pure helpers for the voice add-on. No DOM access here, so every function is
 * unit-tested. The browser component (src/app/p/shop/voice-controls.tsx) wires them to the
 * Web Speech API.
 */
import type { Clause, Money, Verdict } from "@/core/contracts";
import { INTEGRITY_CLAUSE_ID } from "@/core/contracts";
import { toCents } from "@/core/money";

export type VoiceCommand = "approve_cart" | "reject_cart";

export function normalizeTranscript(t: string): string {
  return t
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NEGATION = /\b(don't|dont|do not|never|not|no)\b/;

/**
 * "approve cart" / "confirm the cart" -> approve_cart; "reject cart" / "cancel the cart" ->
 * reject_cart. A negation before the verb, both verbs at once, or no "cart" -> null.
 */
export function matchVoiceCommand(transcript: string): VoiceCommand | null {
  const t = normalizeTranscript(transcript);
  if (!/\bcart\b/.test(t)) return null;
  const approve = t.search(/\b(approve|confirm)\b/);
  const reject = t.search(/\b(reject|cancel|decline)\b/);
  if (approve >= 0 && reject >= 0) return null;
  const at = approve >= 0 ? approve : reject;
  if (at < 0) return null;
  if (NEGATION.test(t.slice(0, at))) return null;
  return approve >= 0 ? "approve_cart" : "reject_cart";
}

export type ParsedVoiceCommand = { kind: VoiceCommand } | { kind: "choose_option"; index: number };

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, first: 1, second: 2, third: 3 };

/** The option number named in a transcript, 1 to 3, or null (none named, several named, out of range, or negated). */
export function matchOptionIndex(transcript: string): number | null {
  const t = normalizeTranscript(transcript);
  const hits: { at: number; index: number | null }[] = [];
  for (const m of t.matchAll(/\boption (\d+|one|two|three)\b/g)) {
    const raw = m[1];
    hits.push({ at: m.index ?? 0, index: /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : NUMBER_WORDS[raw] });
  }
  for (const m of t.matchAll(/\b(first|second|third) option\b/g)) hits.push({ at: m.index ?? 0, index: NUMBER_WORDS[m[1]] });
  if (hits.length === 0) return null;
  const indexes = new Set(hits.map((h) => h.index));
  if (indexes.size !== 1) return null;
  const [index] = [...indexes];
  if (index === null || index < 1 || index > 3) return null;
  const first = Math.min(...hits.map((h) => h.at));
  if (NEGATION.test(t.slice(0, first))) return null;
  return index;
}

/**
 * "option two", "pick option 2", "choose the second option" -> choose_option; "approve cart" and
 * "reject cart" as in matchVoiceCommand. A transcript that names an option and a cart verb, or is
 * negated, gives null.
 */
export function parseVoiceCommand(transcript: string): ParsedVoiceCommand | null {
  const cart = matchVoiceCommand(transcript);
  const index = matchOptionIndex(transcript);
  if (cart && index !== null) return null;
  if (cart) return { kind: cart };
  return index !== null ? { kind: "choose_option", index } : null;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "$42.18" -> "42 dollars and 18 cents". */
export function speakMoney(m: Money): string {
  if (m.currency.toUpperCase() !== "USD") return `${m.value} ${m.currency}`;
  const cents = toCents(m);
  const sign = cents < 0 ? "minus " : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rest = abs % 100;
  if (dollars === 0 && rest === 0) return "0 dollars";
  if (rest === 0) return `${sign}${plural(dollars, "dollar")}`;
  if (dollars === 0) return `${sign}${plural(rest, "cent")}`;
  return `${sign}${plural(dollars, "dollar")} and ${plural(rest, "cent")}`;
}

/** Replaces "$1,234.56" inside text with spoken money. */
export function speakText(text: string): string {
  return text.replace(/\$(\d[\d,]*)(?:\.(\d{2}))?/g, (_all, whole: string, cents: string | undefined) =>
    speakMoney({ currency: "USD", value: `${whole.replace(/,/g, "")}.${cents ?? "00"}` }),
  );
}

function clauseNumber(id: string): string {
  return /^c\d+$/.test(id) ? id.slice(1) : id;
}

function trimDot(s: string): string {
  return s.replace(/[.\s]+$/, "");
}

export function slipUtterances(summary: string | null, clauses: Pick<Clause, "id" | "label">[]): string[] {
  const head = summary ? `Your slip: ${trimDot(speakText(summary))}.` : "Your slip.";
  return [head, ...clauses.map((c) => `Clause ${clauseNumber(c.id)}: ${trimDot(speakText(c.label))}.`)];
}

const HEADS: Record<Verdict["decision"], string> = {
  within: "Within the slip.",
  outside: "Outside the slip.",
  ask: "The guard needs your call.",
};

/** "Outside the slip. Clause 1: ... Clause 2: One gift. Integrity: the listing tried to give the agent orders." */
export function verdictUtterance(verdict: Pick<Verdict, "decision" | "violations" | "unknowns">, clauses: Pick<Clause, "id" | "label">[]): string {
  const cited = verdict.decision === "ask" ? verdict.unknowns.map((u) => u.clauseId) : verdict.violations.map((v) => v.clauseId);
  const unique = [...new Set(cited)].sort((a, b) => {
    if (a === INTEGRITY_CLAUSE_ID) return 1;
    if (b === INTEGRITY_CLAUSE_ID) return -1;
    const na = Number.parseInt(clauseNumber(a), 10);
    const nb = Number.parseInt(clauseNumber(b), 10);
    return Number.isNaN(na) || Number.isNaN(nb) ? a.localeCompare(b) : na - nb;
  });
  const parts = unique.map((id) => {
    if (id === INTEGRITY_CLAUSE_ID) return "Integrity: the listing tried to give the agent orders.";
    const c = clauses.find((x) => x.id === id);
    return `Clause ${clauseNumber(id)}: ${trimDot(speakText(c ? c.label : id))}.`;
  });
  return [HEADS[verdict.decision], ...parts].join(" ");
}

export function cartUtterance(
  lines: { title: string; quantity: number }[],
  totals: { capture: Money; release: Money },
): string {
  const what = lines.map((l) => `${l.quantity} ${l.title}`).join(", ");
  return `The cart: ${what}. Capturing ${speakMoney(totals.capture)} and releasing ${speakMoney(totals.release)}. Say approve cart, or press Approve.`;
}

/** "Option 1: Clockwork Rex, 42 dollars and 18 cents. Within the slip." One line per option. */
export function optionsUtterances(
  options: { rank: number; lines: { title: string; quantity: number }[]; proposal: { amount: Money }; verdict: Pick<Verdict, "decision"> }[],
): string[] {
  if (options.length < 2) return [];
  return [
    `${options.length} carts passed the guard. Say option and a number to choose.`,
    ...options.map((o) => {
      const what = o.lines.map((l) => (l.quantity > 1 ? `${l.quantity} ${l.title}` : l.title)).join(", ");
      return `Option ${o.rank}: ${what}, ${speakMoney(o.proposal.amount)}. ${HEADS[o.verdict.decision]}`;
    }),
  ];
}

export interface SpeechSupport {
  recognition: boolean;
  synthesis: boolean;
}

/** Feature detection against a window-like object (tests pass plain objects). */
export function detectSpeechSupport(win: unknown): SpeechSupport {
  if (!win || typeof win !== "object") return { recognition: false, synthesis: false };
  const w = win as Record<string, unknown>;
  const recognition = typeof w.SpeechRecognition === "function" || typeof w.webkitSpeechRecognition === "function";
  const synth = w.speechSynthesis as Record<string, unknown> | undefined;
  const synthesis = !!synth && typeof synth.speak === "function" && typeof w.SpeechSynthesisUtterance === "function";
  return { recognition, synthesis };
}
