/**
 * Settlement math: the single purchase proposal for the toll slip, the usage split in basis points,
 * and the network payout slip that pays publishers.
 */
import type { Clause, Money, NewProposal, NewSlip, ProposalItem, Slip } from "@/core/contracts";
import { formatMoney, mulMoney, sumMoney, toCents } from "@/core/money";
import { catalogFacts } from "./metering";
import { TOLL_ROAD, type Meter, type PublisherEarning } from "./types";

export const NETWORK_PRINCIPAL = { name: "Toll Road network", email: null };
export const NETWORK_SLIP_HOURS = 24;

/**
 * One item per (publisher, unit price), quantity = fetch count. Every unit price stays within the
 * rate card, and the items still add up to each publisher's total.
 */
export function settlementItems(meters: Meter[]): ProposalItem[] {
  const groups = new Map<string, { meter: Meter; count: number }>();
  for (const m of meters) {
    const key = `${m.publisherId}|${m.amount.currency}|${m.amount.value}`;
    const prev = groups.get(key);
    groups.set(key, { meter: prev?.meter ?? m, count: (prev?.count ?? 0) + 1 });
  }
  return [...groups.values()]
    .sort(
      (a, b) =>
        a.meter.publisherId.localeCompare(b.meter.publisherId) || toCents(a.meter.amount) - toCents(b.meter.amount),
    )
    .map(({ meter, count }) => ({
      title: `${meter.publisherName}: ${count} fetch${count === 1 ? "" : "es"} at ${formatMoney(meter.amount)}`,
      quantity: count,
      unitPrice: meter.amount,
      facts: catalogFacts(null, meter.publisherId),
      sourceUrl: null,
    }));
}

export function itemsTotal(items: ProposalItem[], currency = "USD"): Money {
  return sumMoney(
    items.map((i) => mulMoney(i.unitPrice, i.quantity)),
    currency,
  );
}

export function buildSettlementProposal(slip: Slip, meters: Meter[]): NewProposal {
  const items = settlementItems(meters);
  return {
    slipId: slip.id,
    kind: "purchase",
    amount: itemsTotal(items, slip.budget.currency),
    payee: null,
    items,
    evidence: [],
    rationale: `Settle ${meters.length} metered fetch${meters.length === 1 ? "" : "es"} in one capture`,
  };
}

/**
 * Largest-remainder rounding of each share of 10000 basis points. Leftover points go to the
 * largest remainders; ties break by key. The result always sums to exactly 10000.
 */
export function largestRemainderBps(entries: { key: string; cents: number }[]): { key: string; weightBps: number }[] {
  const total = entries.reduce((s, e) => s + e.cents, 0);
  if (entries.length === 0 || total <= 0) throw new Error("A split needs at least one positive share.");
  const rows = entries.map((e) => {
    const exact = (e.cents * 10000) / total;
    const floor = Math.floor(exact);
    return { key: e.key, floor, rest: exact - floor };
  });
  let left = 10000 - rows.reduce((s, r) => s + r.floor, 0);
  const order = [...rows].sort((a, b) => b.rest - a.rest || a.key.localeCompare(b.key));
  const bonus = new Map<string, number>();
  for (const r of order) {
    if (left <= 0) break;
    bonus.set(r.key, (bonus.get(r.key) ?? 0) + 1);
    left -= 1;
  }
  return rows.map((r) => ({ key: r.key, weightBps: r.floor + (bonus.get(r.key) ?? 0) }));
}

/** Usage weights keyed by payout email; leftover points break ties by publisher id. */
export function usageSplits(earnings: PublisherEarning[]): { payee: string; weightBps: number }[] {
  const emails = new Map(earnings.map((e) => [e.publisherId, e.email]));
  return largestRemainderBps(earnings.map((e) => ({ key: e.publisherId, cents: toCents(e.total) }))).map((s) => ({
    payee: emails.get(s.key) ?? s.key,
    weightBps: s.weightBps,
  }));
}

function pct(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}

export function buildNetworkSlip(input: {
  tollSlip: Slip;
  captureId: string;
  earnings: PublisherEarning[];
  now: Date;
}): NewSlip {
  const { tollSlip, earnings } = input;
  const currency = tollSlip.budget.currency;
  const captured = sumMoney(
    earnings.map((e) => e.total),
    currency,
  );
  const splits = usageSplits(earnings);
  const names = new Map(earnings.map((e) => [e.email, e.name]));
  const expiresAt = new Date(input.now.getTime() + NETWORK_SLIP_HOURS * 3_600_000).toISOString();
  const clauses: Clause[] = [
    { id: "c1", kind: "budget_max", label: `Pay out no more than the ${formatMoney(captured)} captured`, amount: captured },
    {
      id: "c2",
      kind: "split_rule",
      label: `Split by usage: ${splits.map((s) => `${names.get(s.payee) ?? s.payee} ${pct(s.weightBps)}`).join(", ")}`,
      splits,
    },
    {
      id: "c3",
      kind: "payee_allowlist",
      label: `Pay only ${earnings.map((e) => e.name).join(", ")}`,
      payees: earnings.map((e) => e.email),
    },
    { id: "c4", kind: "expires_at", label: `Pay within ${NETWORK_SLIP_HOURS} hours`, at: expiresAt },
  ];
  return {
    pipeline: TOLL_ROAD,
    parentId: null,
    principal: NETWORK_PRINCIPAL,
    intent: `Pay each publisher exactly what the research agent's fetches earned them under toll slip ${tollSlip.id}.`,
    clauses,
    budget: captured,
    expiresAt,
    meta: { role: "network_payout", tollSlipId: tollSlip.id, captureId: input.captureId },
  };
}

export function payoutReceivers(earnings: PublisherEarning[]): { receiverEmail: string; amount: Money; note: string }[] {
  return earnings.map((e) => ({
    receiverEmail: e.email,
    amount: e.total,
    note: `Toll Road: ${e.fetches} fetch${e.fetches === 1 ? "" : "es"} of your articles`,
  }));
}

export function buildPayoutProposal(networkSlip: Slip, earnings: PublisherEarning[]): NewProposal {
  return {
    slipId: networkSlip.id,
    kind: "payout",
    amount: sumMoney(
      earnings.map((e) => e.total),
      networkSlip.budget.currency,
    ),
    payee: null,
    items: [],
    evidence: [],
    rationale: `Usage-weighted payout to ${earnings.length} publisher${earnings.length === 1 ? "" : "s"}`,
  };
}

