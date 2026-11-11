/**
 * The toll booth. One synchronous function answers both the HTTP route and the crawler's
 * fetch_article tool. There is no await anywhere in it, so on Node's single thread nothing can run
 * between reading a slip's meters and writing the new one: concurrent fetches cannot overspend.
 */
import type { GuardFn, Slip, Store, Verdict } from "@/core/contracts";
import { appendVerdictEvent } from "@/core/events";
import { newId } from "@/core/ids";
import { formatMoney, zeroMoney } from "@/core/money";
import { contentOf, publishersOf } from "./catalog";
import { buildMeterProposal, metersForSlip, metersOf, runningTotals } from "./metering";
import {
  gatewayPath,
  SLIP_HEADER,
  TOLL_ROAD,
  WWW_AUTHENTICATE,
  type Content,
  type GatewayResult,
  type Meter,
  type Publisher,
  type QuoteBody,
  type RefusalReason,
  type RunningTotals,
} from "./types";

export interface GatewayDeps {
  store: Store;
  guard: GuardFn;
  now(): Date;
  baseUrl: string;
}

export const HOW_TO_PAY = `Sign a Permission Slip for toll-road (POST /api/runs with pipeline "toll-road"), then resend this request with header ${SLIP_HEADER}: <slip id>.`;

/** Reasons after which a crawler must stop and ask its operator for a new slip. */
export const STOP_REASONS: RefusalReason[] = ["budget_exhausted", "slip_expired", "slip_not_active", "slip_unknown", "no_slip"];

export function isTollSlip(slip: Slip | null): slip is Slip {
  return !!slip && slip.pipeline === TOLL_ROAD && slip.meta.role === "toll";
}

/** Clause kind of each violation, mapped to the refusal reason (expiry, then cap, then budget). */
export function refusalReason(slip: Slip, verdict: Verdict): RefusalReason {
  const kinds = new Set(verdict.violations.map((v) => slip.clauses.find((c) => c.id === v.clauseId)?.kind ?? null));
  if (kinds.has("expires_at")) return "slip_expired";
  if (kinds.has("rate_card")) return "price_above_cap";
  if (kinds.has("budget_max")) return "budget_exhausted";
  return "needs_review";
}

function reasonMessage(slip: Slip, verdict: Verdict, reason: RefusalReason): string {
  const kind = reason === "slip_expired" ? "expires_at" : reason === "price_above_cap" ? "rate_card" : reason === "budget_exhausted" ? "budget_max" : null;
  const hit = verdict.violations.find((v) => slip.clauses.find((c) => c.id === v.clauseId)?.kind === kind) ?? verdict.violations[0] ?? null;
  if (hit) return hit.message;
  const unknown = verdict.unknowns[0];
  return unknown ? unknown.message : "The guard could not approve this fetch.";
}

function baseHeaders(): Record<string, string> {
  return { "Cache-Control": "no-store" };
}

function quote(
  content: Content,
  publisher: Publisher | null,
  reason: RefusalReason,
  message: string,
  totals?: RunningTotals,
): GatewayResult {
  const body: QuoteBody = {
    error: "payment_required",
    reason,
    message,
    price: content.price.value,
    currency: content.price.currency,
    publisher: publisher?.name ?? "Unknown publisher",
    content: { id: content.id, title: content.title },
    howToPay: HOW_TO_PAY,
    ...(totals ? { spent: totals.spent.value, remaining: totals.remaining.value } : {}),
  };
  return {
    status: 402,
    headers: { ...baseHeaders(), "WWW-Authenticate": WWW_AUTHENTICATE, "x-toll-price": content.price.value },
    body,
  };
}

function eventTotals(t: RunningTotals) {
  return { fetches: t.fetches, spent: t.spent, remaining: t.remaining, byPublisher: t.byPublisher };
}

/**
 * GET /api/p/toll-road/content/[id] semantics. `slipHeader` is the raw x-permission-slip value
 * (null when absent). Writes meters and ledger events; never calls PayPal.
 */
export function tollBooth(deps: GatewayDeps, contentId: string, slipHeader: string | null): GatewayResult {
  const { store } = deps;
  const content = contentOf(store).get(contentId);
  if (!content) {
    return { status: 404, headers: baseHeaders(), body: { error: "not_found", message: `No content with id "${contentId}".` } };
  }
  const publisher = publishersOf(store).get(content.publisherId);
  const price = formatMoney(content.price);

  const slipId = (slipHeader ?? "").trim();
  if (!slipId) {
    return quote(content, publisher, "no_slip", `This article costs ${price} per fetch. Send a signed Permission Slip to read it.`);
  }
  const slip = store.slips.get(slipId);
  if (!isTollSlip(slip)) {
    return quote(content, publisher, "slip_unknown", "No toll slip matches that id.");
  }
  if (slip.status !== "active") {
    return quote(content, publisher, "slip_not_active", `That slip is ${slip.status}. It has to be signed with PayPal before it can pay.`);
  }
  if (!publisher) {
    return quote(content, null, "needs_review", "This article has no registered publisher, so nobody could be paid for it.");
  }

  const now = deps.now();
  const meters = metersForSlip(store, slip.id);
  const sourceUrl = `${deps.baseUrl}${gatewayPath(content.id)}`;

  // Already paid under this slip: serve it again for free while the slip is live.
  const paid = meters.find((m) => m.contentId === content.id);
  if (paid && now.getTime() <= Date.parse(slip.expiresAt)) {
    const totals = runningTotals(slip, meters);
    return {
      status: 200,
      headers: { ...baseHeaders(), "x-toll-charged": "0.00", "x-toll-remaining": totals.remaining.value },
      body: {
        id: content.id,
        title: content.title,
        publisher: publisher.name,
        body: content.body,
        charged: zeroMoney(content.price.currency),
        alreadyPaid: true,
        meterId: paid.id,
        spent: totals.spent,
        remaining: totals.remaining,
      },
    };
  }

  const proposal = buildMeterProposal({ slip, content, publisher, sourceUrl, now });
  const before = runningTotals(slip, meters);
  const verdict = deps.guard(slip, proposal, { spent: before.spent, now });
  appendVerdictEvent(store.ledger, slip.id, proposal, verdict);

  if (verdict.decision !== "within") {
    const reason = refusalReason(slip, verdict);
    const message = reasonMessage(slip, verdict, reason);
    store.ledger.append(slip.id, "toll-road.refused", "guard", {
      message: `402 ${reason.replace(/_/g, " ")}: "${content.title}" (${price})`,
      reason,
      detail: message,
      contentId: content.id,
      title: content.title,
      publisherId: publisher.id,
      publisherName: publisher.name,
      price: content.price,
      proposalId: proposal.id,
      ...eventTotals(before),
    });
    return quote(content, publisher, reason, message, before);
  }

  const meter: Meter = {
    id: newId("meter"),
    slipId: slip.id,
    contentId: content.id,
    title: content.title,
    publisherId: publisher.id,
    publisherName: publisher.name,
    payeeEmail: publisher.email,
    amount: content.price,
    proposalId: proposal.id,
    at: now.toISOString(),
    settled: false,
    captureId: null,
  };
  metersOf(store).put(meter.id, meter);
  const after = runningTotals(slip, [...meters, meter]);
  store.ledger.append(slip.id, "toll-road.metered", "system", {
    message: `Paid ${price} to ${publisher.name} for "${content.title}"`,
    meterId: meter.id,
    contentId: content.id,
    title: content.title,
    publisherId: publisher.id,
    publisherName: publisher.name,
    amount: content.price,
    proposalId: proposal.id,
    ...eventTotals(after),
  });
  return {
    status: 200,
    headers: { ...baseHeaders(), "x-toll-charged": content.price.value, "x-toll-remaining": after.remaining.value },
    body: {
      id: content.id,
      title: content.title,
      publisher: publisher.name,
      body: content.body,
      charged: content.price,
      alreadyPaid: false,
      meterId: meter.id,
      spent: after.spent,
      remaining: after.remaining,
    },
  };
}
