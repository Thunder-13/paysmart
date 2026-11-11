/**
 * Safe to give: min(cap, 10% of the surplus), where surplus = day-30 low-case (p10) balance minus
 * the safety buffer, rounded down to the cent. Receiver amounts split the budget by basis points
 * with largest-remainder rounding, so they sum to exactly the budget and each is within one cent
 * of its exact share (the guard's split_rule tolerance). Receivers under $1.00 are dropped and the
 * rest renormalized.
 */
import { formatMoney, fromCents } from "@/core/money";
import type { GiveResult, PayoutLine, ReceiverRow } from "./types";
import { largestRemainder } from "./allocation";

export const GIVE_SHARE_BPS = 1000;
export const MIN_PAYOUT_CENTS = 100;

export interface GiveMath {
  surplusCents: number;
  tenPercentCents: number;
  budgetCents: number;
}

export function safeToGive(day30P10Cents: number, bufferCents: number, capCents: number): GiveMath {
  const surplusCents = Math.max(0, day30P10Cents - bufferCents);
  const tenPercentCents = Math.floor((surplusCents * GIVE_SHARE_BPS) / 10000);
  let budgetCents = Math.min(capCents, tenPercentCents);
  if (budgetCents < MIN_PAYOUT_CENTS) budgetCents = 0;
  return { surplusCents, tenPercentCents, budgetCents };
}

/** Amounts by basis points; sums to exactly budgetCents. */
export function amountsByBps(budgetCents: number, rows: { handle: string; weightBps: number }[]): Map<string, number> {
  return largestRemainder(
    rows.map((r) => ({ key: r.handle, weight: r.weightBps })),
    budgetCents,
  );
}

export function splitBudget(
  budgetCents: number,
  receivers: ReceiverRow[],
): { payouts: (ReceiverRow & { amountCents: number })[]; dropped: string[] } {
  const dropped: string[] = [];
  let rows = receivers.filter((r) => r.weightBps > 0);
  if (budgetCents <= 0) return { payouts: [], dropped: rows.map((r) => r.handle) };
  for (;;) {
    if (rows.length === 0) return { payouts: [], dropped };
    const bps = largestRemainder(
      rows.map((r) => ({ key: r.handle, weight: r.weightBps })),
      10000,
    );
    const reweighted = rows.map((r) => ({ ...r, weightBps: bps.get(r.handle) ?? 0 }));
    const amounts = amountsByBps(budgetCents, reweighted);
    const small = reweighted.filter((r) => (amounts.get(r.handle) ?? 0) < MIN_PAYOUT_CENTS);
    if (small.length === 0) {
      return { payouts: reweighted.map((r) => ({ ...r, amountCents: amounts.get(r.handle) ?? 0 })), dropped };
    }
    // Drop the lightest under-$1 receiver and try again, so the cut is as small as possible.
    const lightest = [...small].sort((a, b) => a.weightBps - b.weightBps || b.handle.localeCompare(a.handle))[0];
    dropped.push(lightest.handle);
    rows = rows.filter((r) => r.handle !== lightest.handle);
  }
}

export function buildGive(input: { day30P10Cents: number; bufferCents: number; capCents: number; receivers: ReceiverRow[] }): GiveResult {
  const m = safeToGive(input.day30P10Cents, input.bufferCents, input.capCents);
  const { payouts, dropped } = splitBudget(m.budgetCents, input.receivers);
  const usd = (c: number) => fromCents(c, "USD");
  const budgetCents = payouts.length > 0 ? m.budgetCents : 0;
  const lines = [
    `Low-case (p10) balance on day 30: ${formatMoney(usd(input.day30P10Cents))}`,
    `Minus your safety buffer: ${formatMoney(usd(input.bufferCents))}`,
    m.surplusCents > 0 ? `Surplus: ${formatMoney(usd(m.surplusCents))}` : "Surplus: none, the low case leaves no room above your buffer",
    `10% of the surplus: ${formatMoney(usd(m.tenPercentCents))}`,
    `Your monthly cap: ${formatMoney(usd(input.capCents))}`,
    budgetCents > 0
      ? `Safe to give: ${formatMoney(usd(budgetCents))}${budgetCents === input.capCents ? " (your cap is the smaller figure)" : " (10% of the surplus is the smaller figure)"}`
      : "Safe to give: $0.00 this month",
  ];
  const payoutLines: PayoutLine[] = payouts.map((p) => ({
    handle: p.handle,
    email: p.email,
    weightBps: p.weightBps,
    amount: usd(p.amountCents),
    packages: p.packages,
  }));
  return {
    day30P10: usd(input.day30P10Cents),
    buffer: usd(input.bufferCents),
    surplus: usd(m.surplusCents),
    tenPercent: usd(m.tenPercentCents),
    cap: usd(input.capCents),
    budget: usd(budgetCents),
    lines,
    payouts: payoutLines,
    dropped,
  };
}
