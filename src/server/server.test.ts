import { describe, expect, it } from "vitest";
import type { Run } from "@/core/contracts";
import { coreRuntime, newSlipInput } from "@/core/test-helpers";
import { runForSlip, withRunParam } from "./http";
import { recordWebhookEvent, webhookResourceIds } from "./webhook";

describe("withRunParam", () => {
  it("appends run with ? or & and keeps the hash", () => {
    expect(withRunParam("/p/shop", "run_1")).toBe("/p/shop?run=run_1");
    expect(withRunParam("/p/bounty?b=2", "run_1")).toBe("/p/bounty?b=2&run=run_1");
    expect(withRunParam("/p/bounty?b=2#pledge", "run_1")).toBe("/p/bounty?b=2&run=run_1#pledge");
    expect(withRunParam("https://evil.example/x", "run_1")).toBe("/?run=run_1");
    expect(withRunParam("//evil.example", null)).toBe("/");
  });
});

describe("runForSlip", () => {
  it("prefers the waiting run, else the newest", () => {
    const base = { pipeline: "shop", step: "s", state: {}, wait: null, error: null, createdAt: "", updatedAt: "" } as const;
    const runs = [
      { ...base, id: "r3", slipId: "slip_a", status: "done" },
      { ...base, id: "r2", slipId: "slip_a", status: "waiting" },
      { ...base, id: "r1", slipId: "slip_b", status: "waiting" },
    ] as Run[];
    expect(runForSlip(runs, "slip_a")).toMatchObject({ waiting: { id: "r2" }, latest: { id: "r3" } });
    expect(runForSlip(runs, "slip_c")).toEqual({ waiting: null, latest: null });
  });
});

describe("webhooks", () => {
  it("collects ids from resource, related ids, disputes, payouts and links", () => {
    expect(
      webhookResourceIds({
        id: "REF1",
        supplementary_data: { related_ids: { order_id: "O1", authorization_id: "A1", capture_id: "C1" } },
        links: [{ href: "https://api-m.sandbox.paypal.com/v2/payments/captures/C9", rel: "up" }],
      }),
    ).toEqual(["REF1", "C1", "A1", "O1", "C9"]);
    expect(webhookResourceIds({ dispute_id: "D1", disputed_transactions: [{ seller_transaction_id: "C2" }] })).toEqual(["C2"]);
    expect(webhookResourceIds({ batch_header: { payout_batch_id: "B1" } })).toEqual(["B1"]);
  });

  it("records the event on the owning slip, updates status, and dedupes", () => {
    const rt = coreRuntime();
    const slip = rt.core.createSlip(newSlipInput());
    rt.store.slips.update(slip.id, { status: "settled", rail: { ...slip.rail, captureIds: ["CAP1"] } });
    const event = {
      id: "WH-1",
      event_type: "PAYMENT.CAPTURE.REFUNDED",
      resource_type: "refund",
      summary: "A $30.00 USD capture payment was refunded",
      resource: { id: "REF9", links: [{ rel: "up", href: "https://api-m.sandbox.paypal.com/v2/payments/captures/CAP1" }] },
    };
    expect(recordWebhookEvent(rt.store, event, rt.now())).toEqual({ slipId: slip.id, duplicate: false });
    expect(rt.store.slips.get(slip.id)!.status).toBe("refunded");
    const types = rt.store.ledger.list(slip.id).map((e) => e.type);
    expect(types.slice(-2)).toEqual(["webhook.received", "slip.status"]);
    expect(recordWebhookEvent(rt.store, event, rt.now())).toEqual({ slipId: slip.id, duplicate: true });
    expect(rt.store.ledger.list(slip.id).map((e) => e.type)).toEqual(types);
    expect(recordWebhookEvent(rt.store, { id: "WH-2", event_type: "X", resource: { id: "nobody" } }, rt.now())).toEqual({ slipId: null, duplicate: false });
  });

  it("marks disputes and voids", () => {
    const rt = coreRuntime();
    const slip = rt.core.createSlip(newSlipInput());
    rt.store.slips.update(slip.id, { status: "active", rail: { ...slip.rail, authorizationId: "AUTH1", captureIds: ["CAP1"] } });
    recordWebhookEvent(rt.store, { id: "WH-3", event_type: "PAYMENT.AUTHORIZATION.VOIDED", resource: { id: "AUTH1" } }, rt.now());
    expect(rt.store.slips.get(slip.id)!.status).toBe("released");
    recordWebhookEvent(rt.store, { id: "WH-4", event_type: "CUSTOMER.DISPUTE.CREATED", resource: { dispute_id: "D1", disputed_transactions: [{ seller_transaction_id: "CAP1" }] } }, rt.now());
    expect(rt.store.slips.get(slip.id)!.status).toBe("disputed");
  });
});
