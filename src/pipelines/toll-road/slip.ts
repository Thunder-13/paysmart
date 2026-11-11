/** Toll slip compilation: compiler guidance, the deterministic mock, and a rate-card safety net. */
import type { Clause, CompiledSlip, Money } from "@/core/contracts";
import { formatMoney, fromCents, money } from "@/core/money";

export const DEFAULT_BUDGET = "0.15";
export const DEFAULT_CAP = "0.05";
export const DEFAULT_MINUTES = 60;

export const COMPILER_GUIDANCE = [
  "This is a Toll Road slip: an AI research agent pays publishers per article fetch.",
  "Use exactly three clause kinds: budget_max (total spend), rate_card with unit \"fetch\" (the most the agent may pay for one article), and expires_at.",
  "Do not add any other clause kinds.",
].join(" ");

export interface ParsedIntent {
  budget: Money;
  cap: Money;
  minutes: number;
}

/** Reads budget, per-fetch cap and duration out of plain words. Defaults: $0.15, $0.05, 60 minutes. */
export function parseIntent(intent: string): ParsedIntent {
  const dollars = [...intent.matchAll(/\$\s*(\d+(?:\.\d{1,2})?)/g)].map((m) => money(m[1]));
  const cents = /(\d+)\s*(?:cents?\b|¢)/i.exec(intent);
  const budget = dollars[0] ?? money(DEFAULT_BUDGET);
  const cap = cents ? fromCents(Number.parseInt(cents[1], 10)) : (dollars[1] ?? money(DEFAULT_CAP));

  let minutes = DEFAULT_MINUTES;
  const mins = /(\d+)\s*(?:minutes?|mins?)\b/i.exec(intent);
  const hours = /(\d+)\s*(?:hours?|hrs?)\b/i.exec(intent);
  const days = /(\d+)\s*days?\b/i.exec(intent);
  if (mins) minutes = Number.parseInt(mins[1], 10);
  else if (hours) minutes = Number.parseInt(hours[1], 10) * 60;
  else if (days) minutes = Number.parseInt(days[1], 10) * 1440;
  else if (/\b(an|one|the next) hour\b/i.test(intent)) minutes = 60;
  return { budget, cap, minutes: Math.max(2, minutes) };
}

export function mockCompile(intent: string, now: Date): CompiledSlip {
  const { budget, cap, minutes } = parseIntent(intent);
  const at = new Date(now.getTime() + minutes * 60_000).toISOString();
  return {
    clauses: [
      { id: "c1", kind: "budget_max", label: `Spend no more than ${formatMoney(budget)} in total`, amount: budget },
      { id: "c2", kind: "rate_card", unit: "fetch", label: `At most ${formatMoney(cap)} per article`, price: cap },
      { id: "c3", kind: "expires_at", label: "", at },
    ],
    budget,
    expiresAt: at,
    summary: `Your research agent may spend up to ${formatMoney(budget)} on articles, at most ${formatMoney(cap)} each, for ${minutes} minutes.`,
  };
}

/** A live compiler might forget the per-fetch cap; the booth needs one, so add it from the words. */
export function withRateCard(clauses: Clause[], intent: string): Clause[] {
  if (clauses.some((c) => c.kind === "rate_card" && c.unit === "fetch")) return clauses;
  const { cap } = parseIntent(intent);
  return [...clauses, { id: `c${clauses.length + 1}`, kind: "rate_card", unit: "fetch", label: `At most ${formatMoney(cap)} per article`, price: cap }];
}
