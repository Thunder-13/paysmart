/**
 * Live counters for the Toll Road page, reduced from the toll slip's ledger events. Pure and
 * client-safe: the page feeds it the SSE stream, tests feed it store.ledger.list().
 */
import type { LedgerEvent, Money } from "@/core/contracts";
import { formatMoney } from "@/core/money";
import type { PublisherEarning, RefusalReason } from "./types";

export type StampKind = "paid" | "refused" | "agent" | "milestone";

export interface Stamp {
  key: string;
  kind: StampKind;
  title: string;
  detail: string | null;
  contentId: string | null;
  reason: RefusalReason | null;
  injection: boolean;
  at: string;
}

export interface TollCounters {
  paid: number;
  refused: number;
  spent: Money | null;
  remaining: Money | null;
  byPublisher: PublisherEarning[];
  stamps: Stamp[];
  captured: Money | null;
}

export const REASON_WORDS: Record<RefusalReason, string> = {
  no_slip: "No slip",
  slip_unknown: "Unknown slip",
  slip_not_active: "Slip not signed",
  slip_expired: "Slip expired",
  price_above_cap: "Price above cap",
  budget_exhausted: "Budget exhausted",
  needs_review: "Needs review",
};

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function asMoney(v: unknown): Money | null {
  const o = obj(v);
  return typeof o.value === "string" && typeof o.currency === "string" ? { currency: o.currency, value: o.value } : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function earnings(v: unknown): PublisherEarning[] | null {
  if (!Array.isArray(v)) return null;
  return v.flatMap((x) => {
    const o = obj(x);
    const total = asMoney(o.total);
    return typeof o.publisherId === "string" && total
      ? [{ publisherId: o.publisherId, name: str(o.name) ?? o.publisherId, email: str(o.email) ?? "", fetches: Number(o.fetches) || 0, total }]
      : [];
  });
}

export function emptyCounters(): TollCounters {
  return { paid: 0, refused: 0, spent: null, remaining: null, byPublisher: [], stamps: [], captured: null };
}

export function reduceTollEvents(events: LedgerEvent[]): TollCounters {
  const out = emptyCounters();
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  for (const e of sorted) {
    const d = obj(e.data);
    const key = `${e.slipId}:${e.seq}`;
    switch (e.type) {
      case "toll-road.metered": {
        out.paid += 1;
        out.spent = asMoney(d.spent) ?? out.spent;
        out.remaining = asMoney(d.remaining) ?? out.remaining;
        out.byPublisher = earnings(d.byPublisher) ?? out.byPublisher;
        const amount = asMoney(d.amount);
        out.stamps.push({
          key,
          kind: "paid",
          title: `Paid ${amount ? formatMoney(amount) : ""}`.trim(),
          detail: `"${str(d.title) ?? ""}" · ${str(d.publisherName) ?? ""}`,
          contentId: str(d.contentId),
          reason: null,
          injection: false,
          at: e.at,
        });
        break;
      }
      case "toll-road.refused": {
        out.refused += 1;
        out.spent = asMoney(d.spent) ?? out.spent;
        out.remaining = asMoney(d.remaining) ?? out.remaining;
        const reason = (str(d.reason) ?? "needs_review") as RefusalReason;
        const price = asMoney(d.price);
        out.stamps.push({
          key,
          kind: "refused",
          title: `402 ${REASON_WORDS[reason] ?? reason}`,
          detail: `"${str(d.title) ?? ""}"${price ? ` · ${formatMoney(price)}` : ""}`,
          contentId: str(d.contentId),
          reason,
          injection: false,
          at: e.at,
        });
        break;
      }
      case "toll-road.injection_flagged": {
        const id = str(d.contentId);
        const stamp = [...out.stamps].reverse().find((s) => s.kind === "paid" && s.contentId === id);
        if (stamp) stamp.injection = true;
        break;
      }
      case "agent.step": {
        const step = obj(d.step);
        if (d.label === "toll-road.crawler" && step.kind === "message" && typeof step.text === "string") {
          out.stamps.push({ key, kind: "agent", title: "Agent", detail: step.text, contentId: null, reason: null, injection: false, at: e.at });
        }
        break;
      }
      case "toll-road.settled": {
        out.captured = asMoney(d.total);
        out.stamps.push({ key, kind: "milestone", title: "Settled", detail: str(d.message), contentId: null, reason: null, injection: false, at: e.at });
        break;
      }
      case "toll-road.crawl_finished":
      case "toll-road.payout_split":
        out.stamps.push({
          key,
          kind: "milestone",
          title: e.type === "toll-road.payout_split" ? "Publishers paid" : "Crawl ended",
          detail: str(d.message),
          contentId: null,
          reason: null,
          injection: false,
          at: e.at,
        });
        break;
    }
  }
  return out;
}
