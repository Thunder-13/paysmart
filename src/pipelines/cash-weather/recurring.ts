/**
 * Recurring stream detection: group by counterparty and direction, then look for a steady cadence.
 * Pure: same transactions and as-of date in, same streams out.
 */
import { toCents } from "@/core/money";
import type { Cadence, CwTransaction, RecurringStream } from "./types";
import { dayOf, isoOfDay } from "./dates";

const CADENCES: { cadence: Cadence; days: number; tolerance: number; minCount: number }[] = [
  { cadence: "weekly", days: 7, tolerance: 1, minCount: 3 },
  { cadence: "biweekly", days: 14, tolerance: 2, minCount: 3 },
  { cadence: "monthly", days: 30, tolerance: 3, minCount: 3 },
  { cadence: "quarterly", days: 91, tolerance: 7, minCount: 2 },
];

export function counterpartyKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function detectStreams(transactions: CwTransaction[], asOf: string): RecurringStream[] {
  const today = dayOf(asOf);
  const groups = new Map<string, { name: string; direction: "in" | "out"; rows: { id: string; day: number; cents: number }[] }>();
  for (const t of transactions) {
    if (t.amount.currency.toUpperCase() !== "USD") continue;
    const cents = toCents(t.amount);
    if (cents === 0) continue;
    const direction = cents > 0 ? "in" : "out";
    const key = `${direction}:${counterpartyKey(t.counterparty)}`;
    const g = groups.get(key) ?? { name: t.counterparty.trim(), direction, rows: [] };
    g.rows.push({ id: t.id, day: dayOf(t.date), cents: Math.abs(cents) });
    groups.set(key, g);
  }

  const streams: RecurringStream[] = [];
  for (const [key, g] of groups) {
    const rows = [...g.rows].sort((a, b) => a.day - b.day || a.id.localeCompare(b.id));
    if (rows.length < 2) continue;
    const gaps = rows.slice(1).map((r, i) => r.day - rows[i].day);
    const mid = median(gaps);
    const match = CADENCES.find((c) => Math.abs(mid - c.days) <= c.tolerance);
    if (!match || rows.length < match.minCount) continue;
    const inTolerance = gaps.filter((gap) => Math.abs(gap - match.days) <= match.tolerance).length;
    if (inTolerance * 3 < gaps.length * 2) continue;

    const amounts = rows.map((r) => r.cents);
    const last = rows[rows.length - 1].day;
    let next = last + mid;
    while (next <= today) next += mid;
    streams.push({
      counterparty: g.name,
      key: key.slice(key.indexOf(":") + 1),
      direction: g.direction,
      cadence: match.cadence,
      intervalDays: mid,
      typicalCents: median(amounts),
      minCents: Math.min(...amounts),
      maxCents: Math.max(...amounts),
      occurrences: rows.length,
      lastDate: isoOfDay(last),
      nextDate: isoOfDay(next),
      transactionIds: rows.map((r) => r.id),
    });
  }
  return streams.sort((a, b) => a.direction.localeCompare(b.direction) || b.typicalCents - a.typicalCents || a.key.localeCompare(b.key));
}
