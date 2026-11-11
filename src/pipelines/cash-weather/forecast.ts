/**
 * 90-day cash forecast: 500 seeded scenarios over recurring streams, outstanding invoices (paid on
 * dates drawn from each payer's history) and irregular weekly flow resampled from history.
 * Pure and deterministic for a given input and seed. All money is integer cents.
 */
import { fromCents, toCents } from "@/core/money";
import type { CwInvoice, CwTransaction, ForecastResult, InvoiceOutlook, PayerProfile, RecurringStream } from "./types";
import { dayOf, isoOfDay } from "./dates";
import { buildPayerProfiles, dueDayOf, matchPaidInvoices, payerKey, payerMatches } from "./payers";
import { detectStreams, median } from "./recurring";
import { mulberry32, pick, randInt, type Rng } from "./rng";
import { labelWeeks } from "./weather";

export const SCENARIOS = 500;
export const HORIZON_DAYS = 90;
export const HISTORY_DAYS = 180;
export const INCOME_STREAM_HIT_RATE = 0.95;
export const UNKNOWN_LATENESS_PRIOR = [0, 7, 14];
/** Chance that a repeat client's next invoice actually goes out on schedule. */
export const REPEAT_INVOICE_RATE = 0.8;
const OUTSTANDING = new Set(["SENT", "UNPAID"]);

export interface ForecastInput {
  asOf: string;
  seed: number;
  startCents: number;
  bufferCents: number;
  transactions: CwTransaction[];
  invoices: CwInvoice[];
  scenarios?: number;
}

/** Chance an outstanding invoice gets paid inside the horizon, from the payer's on-time rate. */
export function payProbability(profile: PayerProfile | undefined): number {
  const rate = profile?.onTimeRate ?? null;
  if (rate === null) return 0.85;
  if (rate >= 0.8) return 0.98;
  if (rate >= 0.5) return 0.9;
  return 0.75;
}

export function isOutstanding(invoice: CwInvoice): boolean {
  return OUTSTANDING.has(invoice.status) && invoice.amount.currency.toUpperCase() === "USD";
}

/** Nearest-rank percentile of an ascending-sorted list. */
export function nearestRank(sorted: ArrayLike<number>, p: number): number {
  const idx = Math.max(0, Math.ceil(p * sorted.length) - 1);
  return sorted[idx];
}

interface Occurrence {
  stream: RecurringStream;
  /** Offset from today, 1..horizon. */
  offset: number;
}

function projectOccurrences(streams: RecurringStream[], today: number, horizon: number): Occurrence[] {
  const out: Occurrence[] = [];
  for (const s of streams) {
    for (let d = dayOf(s.nextDate); d <= today + horizon; d += s.intervalDays) {
      if (d > today) out.push({ stream: s, offset: d - today });
    }
  }
  return out;
}

/**
 * An outstanding invoice consumes the next projected income occurrence from the same payer when it
 * falls within 10 days of the due date and 10% of the amount, so a retainer is not counted twice.
 */
function dedupeAgainstInvoices(occurrences: Occurrence[], outstanding: CwInvoice[], today: number): Occurrence[] {
  const removed = new Set<Occurrence>();
  for (const inv of outstanding) {
    const due = Math.max(dueDayOf(inv), today + 1);
    const cents = toCents(inv.amount);
    const hit = occurrences
      .filter((o) => !removed.has(o) && o.stream.direction === "in" && payerMatches(inv, o.stream.counterparty))
      .filter((o) => Math.abs(today + o.offset - due) <= 10 && Math.abs(o.stream.typicalCents - cents) * 10 <= cents)
      .sort((a, b) => a.offset - b.offset)[0];
    if (hit) removed.add(hit);
  }
  return occurrences.filter((o) => !removed.has(o));
}

/**
 * Repeat clients (3+ invoices, steady invoicing gap of 14 to 100 days) who are not already a
 * recurring income stream get their next invoices projected: same median amount and terms, paid on
 * dates drawn from their history like any open invoice. Retainers stay with their stream.
 */
export function projectRepeatInvoices(invoices: CwInvoice[], streams: RecurringStream[], today: number, horizon: number): CwInvoice[] {
  const byPayer = new Map<string, CwInvoice[]>();
  for (const inv of invoices) {
    if (inv.status === "DRAFT" || inv.status === "CANCELLED") continue;
    const list = byPayer.get(payerKey(inv)) ?? [];
    list.push(inv);
    byPayer.set(payerKey(inv), list);
  }
  const out: CwInvoice[] = [];
  for (const [key, list] of [...byPayer].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (list.length < 3) continue;
    const sample = list[0];
    if (streams.some((s) => s.direction === "in" && payerMatches(sample, s.counterparty))) continue;
    const sorted = [...list].sort((a, b) => dayOf(a.issuedAt) - dayOf(b.issuedAt));
    const gap = median(sorted.slice(1).map((inv, i) => dayOf(inv.issuedAt) - dayOf(sorted[i].issuedAt)));
    if (gap < 14 || gap > 100) continue;
    const amount = median(sorted.map((inv) => toCents(inv.amount)));
    const terms = median(sorted.map((inv) => dueDayOf(inv) - dayOf(inv.issuedAt)));
    let issue = dayOf(sorted[sorted.length - 1].issuedAt) + gap;
    while (issue <= today) issue += gap;
    for (let n = 1; issue <= today + horizon; issue += gap, n++) {
      out.push({
        ...sample,
        id: `projected:${key}:${n}`,
        number: "next",
        status: "PROJECTED",
        amount: fromCents(amount, "USD"),
        issuedAt: isoOfDay(issue),
        dueDate: isoOfDay(issue + terms),
      });
    }
  }
  return out;
}

function irregularPool(transactions: CwTransaction[], explained: Set<string>, today: number): number[] {
  const weeks = Math.ceil(HISTORY_DAYS / 7);
  const pool = new Array<number>(weeks).fill(0);
  for (const t of transactions) {
    if (explained.has(t.id)) continue;
    const day = dayOf(t.date);
    const back = today - 1 - day;
    if (back < 0) continue;
    const w = Math.floor(back / 7);
    if (w >= weeks) continue;
    pool[w] += toCents(t.amount);
  }
  return pool;
}

export function forecast(input: ForecastInput): ForecastResult {
  const N = input.scenarios ?? SCENARIOS;
  const H = HORIZON_DAYS;
  const today = dayOf(input.asOf);
  const usd = input.transactions.filter((t) => t.amount.currency.toUpperCase() === "USD");
  const excludedCurrencyCount = input.transactions.length - usd.length;
  const invoices = input.invoices.filter((i) => i.amount.currency.toUpperCase() === "USD");

  const matches = matchPaidInvoices(invoices, usd);
  const payers = buildPayerProfiles(invoices, matches);
  const profileOf = new Map(payers.map((p) => [p.key, p]));
  const streams = detectStreams(usd, input.asOf);

  const explained = new Set<string>([...streams.flatMap((s) => s.transactionIds), ...matches.map((m) => m.transactionId)]);
  const pool = irregularPool(usd, explained, today);
  const outstanding = invoices.filter(isOutstanding).sort((a, b) => dueDayOf(a) - dueDayOf(b) || a.id.localeCompare(b.id));
  const occurrences = dedupeAgainstInvoices(projectOccurrences(streams, today, H), outstanding, today);
  const projected = projectRepeatInvoices(invoices, streams, today, H);

  // balances[d][s]: balance on day d in scenario s.
  const balances: Float64Array[] = Array.from({ length: H + 1 }, () => new Float64Array(N));
  const paidOffsets: (number | null)[][] = outstanding.map(() => new Array<number | null>(N).fill(null));
  const rng: Rng = mulberry32(input.seed);

  for (let s = 0; s < N; s++) {
    const delta = new Array<number>(H + 1).fill(0);

    for (const o of occurrences) {
      const st = o.stream;
      const fixed = st.minCents === st.maxCents;
      if (st.direction === "in") {
        if (rng() >= INCOME_STREAM_HIT_RATE) continue;
        const offset = o.offset + randInt(rng, -2, 2);
        const cents = randInt(rng, st.minCents, st.maxCents);
        if (offset >= 1 && offset <= H) delta[offset] += cents;
      } else {
        const offset = fixed ? o.offset : o.offset + randInt(rng, -2, 2);
        const cents = fixed ? st.typicalCents : randInt(rng, st.minCents, st.maxCents);
        if (offset >= 1 && offset <= H) delta[offset] -= cents;
      }
    }

    outstanding.forEach((inv, i) => {
      const profile = profileOf.get(payerKey(inv));
      if (rng() >= payProbability(profile)) return;
      const history = profile && profile.daysLate.length > 0 ? profile.daysLate : UNKNOWN_LATENESS_PRIOR;
      let payDay = dueDayOf(inv) + pick(rng, history) + randInt(rng, 0, 3);
      if (payDay <= today) payDay = today + randInt(rng, 1, 14);
      const offset = payDay - today;
      if (offset > H) return;
      delta[offset] += toCents(inv.amount);
      paidOffsets[i][s] = offset;
    });

    for (const inv of projected) {
      if (rng() >= REPEAT_INVOICE_RATE) continue;
      const profile = profileOf.get(payerKey(inv));
      if (rng() >= payProbability(profile)) continue;
      const history = profile && profile.daysLate.length > 0 ? profile.daysLate : UNKNOWN_LATENESS_PRIOR;
      const offset = dueDayOf(inv) + pick(rng, history) + randInt(rng, 0, 3) - today;
      if (offset >= 1 && offset <= H) delta[offset] += toCents(inv.amount);
    }

    for (let w = 0; w * 7 + 1 <= H; w++) {
      const total = pool.length > 0 ? pick(rng, pool) : 0;
      const start = w * 7 + 1;
      const end = Math.min(w * 7 + 7, H);
      const n = end - start + 1;
      const per = Math.trunc(total / n);
      for (let d = start; d <= end; d++) delta[d] += per;
      delta[end] += total - per * n;
    }

    let bal = input.startCents;
    balances[0][s] = bal;
    for (let d = 1; d <= H; d++) {
      bal += delta[d];
      balances[d][s] = bal;
    }
  }

  const p10: number[] = [];
  const p50: number[] = [];
  const p90: number[] = [];
  for (let d = 0; d <= H; d++) {
    const col = Float64Array.from(balances[d]).sort();
    p10.push(nearestRank(col, 0.1));
    p50.push(nearestRank(col, 0.5));
    p90.push(nearestRank(col, 0.9));
  }

  const outlooks: InvoiceOutlook[] = outstanding.map((inv, i) => {
    const paid = paidOffsets[i].filter((x): x is number => x !== null).sort((a, b) => a - b);
    const due = dueDayOf(inv);
    return {
      invoiceId: inv.id,
      number: inv.number,
      payer: inv.recipientName?.trim() || inv.recipientEmail,
      amountCents: toCents(inv.amount),
      dueDate: isoOfDay(due),
      daysOverdue: Math.max(0, today - due),
      pIn30: paid.filter((x) => x <= 30).length / N,
      medianPayDay: paid.length > 0 ? nearestRank(paid, 0.5) : null,
      source: inv.source,
    };
  });

  return {
    asOf: input.asOf,
    seed: input.seed,
    scenarios: N,
    horizonDays: H,
    currency: "USD",
    startCents: input.startCents,
    bufferCents: input.bufferCents,
    p10,
    p50,
    p90,
    streams,
    payers,
    invoices: outlooks,
    projected: projected.map((inv) => ({
      payer: inv.recipientName?.trim() || inv.recipientEmail,
      issueDate: inv.issuedAt,
      dueDate: inv.dueDate ?? inv.issuedAt,
      amountCents: toCents(inv.amount),
    })),
    weeks: labelWeeks(p10, p50, input.bufferCents, input.asOf, H),
    excludedCurrencyCount,
  };
}
