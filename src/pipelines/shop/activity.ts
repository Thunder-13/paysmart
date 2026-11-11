/**
 * Turns the parent slip's ledger events into cards for the agent activity stream.
 * Client-safe and pure.
 */
import type { ExtractedFacts, LedgerEvent, Money, Proposal, Verdict } from "@/core/contracts";
import type { DeliveryCheck, ListingSource } from "./types";

export interface SearchResultCard {
  id: string;
  title: string;
  price: Money;
  domain: string;
  availability: string;
  source: ListingSource;
}

export type HelperStage = "hired" | "delivered" | "judged" | "paid" | "unpaid";

export type ActivityCard =
  | { kind: "say"; key: string; text: string }
  | { kind: "search"; key: string; query: string; source: string; maxPrice: Money | null; results: SearchResultCard[]; error: string | null }
  | {
      kind: "inspect";
      key: string;
      listingId: string;
      title: string;
      price: Money | null;
      domain: string;
      source: ListingSource;
      facts: ExtractedFacts;
      excerpt: string;
      hidden: string[];
    }
  | { kind: "verdict"; key: string; seq: number; verdict: Verdict; proposal: Pick<Proposal, "kind" | "amount" | "items"> }
  | {
      kind: "helper";
      key: string;
      childSlipId: string;
      helperName: string;
      brief: string;
      fee: Money | null;
      payee: string;
      message: string | null;
      judged: { verdict: string; detail: string } | null;
      payoutBatchId: string | null;
      stage: HelperStage;
    }
  | { kind: "attest"; key: string; field: string; value: unknown }
  | { kind: "money"; key: string; what: "captured" | "voided" | "refunded"; amount: Money | null; detail: string | null }
  | { kind: "delivery"; key: string; photoRef: string; sample: boolean; check: DeliveryCheck }
  | { kind: "outcome"; key: string; outcome: string; note: string | null };

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function moneyOf(v: unknown): Money | null {
  const o = obj(v);
  return typeof o.value === "string" && typeof o.currency === "string" ? { value: o.value, currency: o.currency } : null;
}

export function activityFromEvents(events: LedgerEvent[]): ActivityCard[] {
  const cards: ActivityCard[] = [];
  const helpers = new Map<string, Extract<ActivityCard, { kind: "helper" }>>();
  for (const e of events) {
    const d = obj(e.data);
    const key = `${e.slipId}-${e.seq}`;
    switch (e.type) {
      case "agent.step": {
        const step = obj(d.step);
        if (step.kind === "message" && typeof step.text === "string") cards.push({ kind: "say", key, text: step.text });
        break;
      }
      case "shop.search":
        cards.push({
          kind: "search",
          key,
          query: str(d.query),
          source: str(d.source, "fixtures"),
          maxPrice: moneyOf(d.maxPrice),
          results: Array.isArray(d.results) ? (d.results as SearchResultCard[]) : [],
          error: typeof d.error === "string" ? d.error : null,
        });
        break;
      case "shop.listing_inspected":
        cards.push({
          kind: "inspect",
          key,
          listingId: str(d.listingId),
          title: str(d.title),
          price: moneyOf(d.price),
          domain: str(d.domain),
          source: (str(d.source, "fixture") as ListingSource) ?? "fixture",
          facts: d.facts as ExtractedFacts,
          excerpt: str(d.excerpt),
          hidden: Array.isArray(d.hidden) ? (d.hidden as string[]) : [],
        });
        break;
      case "guard.verdict": {
        const proposal = obj(d.proposal) as unknown as Proposal;
        const verdict = d.verdict as Verdict | undefined;
        if (!verdict) break;
        cards.push({ kind: "verdict", key, seq: e.seq, verdict, proposal: { kind: proposal.kind, amount: proposal.amount, items: proposal.items ?? [] } });
        break;
      }
      case "shop.helper_hired": {
        const card: Extract<ActivityCard, { kind: "helper" }> = {
          kind: "helper",
          key,
          childSlipId: str(d.childSlipId),
          helperName: str(d.helperName, "Helper"),
          brief: str(d.brief),
          fee: moneyOf(d.fee),
          payee: str(d.payee),
          message: null,
          judged: null,
          payoutBatchId: null,
          stage: "hired",
        };
        helpers.set(card.childSlipId, card);
        cards.push(card);
        break;
      }
      case "shop.helper_delivered": {
        const h = helpers.get(str(d.childSlipId));
        if (h) Object.assign(h, { message: str(d.message), stage: "delivered" });
        break;
      }
      case "shop.helper_judged": {
        const h = helpers.get(str(d.childSlipId));
        if (h) Object.assign(h, { judged: { verdict: str(d.verdict), detail: str(d.detail) }, stage: "judged" });
        break;
      }
      case "shop.helper_paid": {
        const h = helpers.get(str(d.childSlipId));
        if (h) Object.assign(h, { payoutBatchId: str(d.payoutBatchId) || null, stage: "paid" });
        break;
      }
      case "shop.helper_unpaid": {
        const h = helpers.get(str(d.childSlipId));
        if (h) Object.assign(h, { stage: "unpaid" });
        break;
      }
      case "shop.attested":
        cards.push({ kind: "attest", key, field: str(d.field), value: d.value });
        break;
      case "rail.captured":
        cards.push({ kind: "money", key, what: "captured", amount: moneyOf(d.amount), detail: d.finalCapture ? "Final capture" : null });
        break;
      case "rail.voided":
        cards.push({ kind: "money", key, what: "voided", amount: null, detail: "Unspent hold voided" });
        break;
      case "rail.refunded":
        cards.push({ kind: "money", key, what: "refunded", amount: moneyOf(d.amount), detail: str(d.reason) || null });
        break;
      case "shop.delivery_checked":
        cards.push({ kind: "delivery", key, photoRef: str(d.photoRef), sample: d.sample === true, check: d.check as DeliveryCheck });
        break;
      case "shop.outcome":
        cards.push({ kind: "outcome", key, outcome: str(d.outcome), note: typeof d.note === "string" ? d.note : null });
        break;
      default:
        break;
    }
  }
  return cards;
}

/** The newest guard verdict in the stream, for the aria-live announcer and read-aloud. */
export function latestVerdict(cards: ActivityCard[]): Extract<ActivityCard, { kind: "verdict" }> | null {
  for (let i = cards.length - 1; i >= 0; i--) {
    const c = cards[i];
    if (c.kind === "verdict") return c;
  }
  return null;
}
