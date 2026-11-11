/** PayPal webhook handling, separate from the route so it can be tested without Next. */
import type { Slip, SlipStatus, Store } from "@/core/contracts";
import { appendEvent } from "@/core/events";

type Json = Record<string, unknown>;

function obj(v: unknown): Json {
  return v && typeof v === "object" ? (v as Json) : {};
}

/** Every PayPal id a webhook resource can point at, most specific first. */
export function webhookResourceIds(resource: unknown): string[] {
  const r = obj(resource);
  const ids: unknown[] = [r.id];
  const related = obj(obj(r.supplementary_data).related_ids);
  ids.push(related.capture_id, related.authorization_id, related.order_id);
  for (const t of Array.isArray(r.disputed_transactions) ? r.disputed_transactions : []) {
    ids.push(obj(t).seller_transaction_id);
  }
  ids.push(obj(r.batch_header).payout_batch_id, r.payout_batch_id);
  for (const link of Array.isArray(r.links) ? r.links : []) {
    const href = obj(link).href;
    if (typeof href === "string") ids.push(href.split("?")[0].split("/").filter(Boolean).pop());
  }
  return [...new Set(ids.filter((x): x is string => typeof x === "string" && x !== ""))];
}

const STATUS_FOR: Record<string, { to: SlipStatus; unless: SlipStatus[] }> = {
  "PAYMENT.CAPTURE.REFUNDED": { to: "refunded", unless: ["refunded"] },
  "PAYMENT.AUTHORIZATION.VOIDED": { to: "released", unless: ["released", "settled", "refunded"] },
  "CUSTOMER.DISPUTE.CREATED": { to: "disputed", unless: ["disputed"] },
};

/**
 * Record a verified webhook event: find the slip by any resource id, append "webhook.received",
 * and move the slip's status for refunds, voided authorizations and new disputes. Deduplicates by event id.
 */
export function recordWebhookEvent(store: Store, event: unknown, now: Date): { slipId: string | null; duplicate: boolean } {
  const e = obj(event);
  const eventId = typeof e.id === "string" ? e.id : null;
  const eventType = typeof e.event_type === "string" ? e.event_type : "UNKNOWN";
  const seen = store.collection<{ at: string; slipId: string | null }>("core", "webhooks");
  if (eventId && seen.get(eventId)) return { slipId: seen.get(eventId)?.slipId ?? null, duplicate: true };

  let slip: Slip | null = null;
  let matchedId: string | null = null;
  for (const id of webhookResourceIds(e.resource)) {
    slip = store.slips.findByRailId(id);
    if (slip) {
      matchedId = id;
      break;
    }
  }
  if (slip) {
    appendEvent(store.ledger, slip.id, "webhook.received", "webhook", {
      eventId,
      eventType,
      resourceType: typeof e.resource_type === "string" ? e.resource_type : null,
      resourceId: matchedId,
      summary: typeof e.summary === "string" ? e.summary : null,
    });
    const change = STATUS_FOR[eventType];
    if (change && !change.unless.includes(slip.status)) {
      store.slips.update(slip.id, { status: change.to });
      appendEvent(store.ledger, slip.id, "slip.status", "webhook", { from: slip.status, to: change.to, reason: eventType });
    }
  }
  if (eventId) seen.put(eventId, { at: now.toISOString(), slipId: slip?.id ?? null });
  return { slipId: slip?.id ?? null, duplicate: false };
}
