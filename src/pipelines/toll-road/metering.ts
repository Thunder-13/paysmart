/** Meter records, metered proposals and running totals. No PayPal calls live here. */
import type { ExtractedFacts, Proposal, Slip, Store } from "@/core/contracts";
import { newId } from "@/core/ids";
import { addMoney, fromCents, subMoney, sumMoney, toCents, zeroMoney } from "@/core/money";
import { TOLL_ROAD, type Content, type Meter, type Publisher, type PublisherEarning, type RunningTotals } from "./types";

export function metersOf(store: Store) {
  return store.collection<Meter>(TOLL_ROAD, "meters");
}

export function metersForSlip(store: Store, slipId: string): Meter[] {
  return metersOf(store)
    .list()
    .filter((m) => m.slipId === slipId)
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

export function unsettled(meters: Meter[]): Meter[] {
  return meters.filter((m) => !m.settled);
}

export function meterTotal(meters: Meter[], currency = "USD") {
  return sumMoney(
    meters.map((m) => m.amount),
    currency,
  );
}

/**
 * Facts for a metered or settlement item. They come from the catalog only, never from article
 * text, so nothing a publisher writes in a page can reach the guard.
 */
export function catalogFacts(contentId: string | null, publisherId: string): ExtractedFacts {
  return {
    category: "article",
    inStock: true,
    deliveryEstimate: null,
    itemCount: 1,
    attributes: contentId ? { contentId, publisherId } : { publisherId },
    injectionSuspected: false,
  };
}

/** One fetch as a metered_charge proposal: amount = price, payee = publisher, one item at that price. */
export function buildMeterProposal(input: {
  slip: Slip;
  content: Content;
  publisher: Publisher;
  sourceUrl: string;
  now: Date;
}): Proposal {
  const { slip, content, publisher } = input;
  return {
    id: newId("prop"),
    slipId: slip.id,
    kind: "metered_charge",
    amount: content.price,
    payee: { email: publisher.email, merchantId: null, name: publisher.name },
    items: [
      {
        title: content.title,
        quantity: 1,
        unitPrice: content.price,
        facts: catalogFacts(content.id, publisher.id),
        sourceUrl: input.sourceUrl,
      },
    ],
    evidence: [],
    rationale: `Fetch "${content.title}" from ${publisher.name}`,
    createdAt: input.now.toISOString(),
  };
}

/** Per-publisher totals, sorted by publisher id (the tie-break order used for splits). */
export function earningsByPublisher(meters: Meter[], currency = "USD"): PublisherEarning[] {
  const map = new Map<string, { publisherId: string; name: string; email: string; fetches: number; cents: number }>();
  for (const m of meters) {
    const prev = map.get(m.publisherId);
    map.set(m.publisherId, {
      publisherId: m.publisherId,
      name: m.publisherName,
      email: m.payeeEmail,
      fetches: (prev?.fetches ?? 0) + 1,
      cents: (prev?.cents ?? 0) + toCents(m.amount),
    });
  }
  return [...map.values()]
    .sort((a, b) => a.publisherId.localeCompare(b.publisherId))
    .map((e) => ({ publisherId: e.publisherId, name: e.name, email: e.email, fetches: e.fetches, total: fromCents(e.cents, currency) }));
}

/** What the slip has used: settled spend plus every unsettled meter. */
export function meteredSpent(slip: Slip, meters: Meter[]) {
  const currency = slip.budget.currency;
  return addMoney(slip.spent, meterTotal(unsettled(meters), currency));
}

export function runningTotals(slip: Slip, meters: Meter[]): RunningTotals {
  const currency = slip.budget.currency;
  const spent = meteredSpent(slip, meters);
  const left = subMoney(slip.budget, spent);
  return {
    fetches: meters.length,
    spent,
    remaining: toCents(left) < 0 ? zeroMoney(currency) : left,
    byPublisher: earningsByPublisher(meters, currency),
  };
}
