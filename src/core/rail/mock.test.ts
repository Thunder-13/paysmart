import { describe, expect, it } from "vitest";
import { money } from "../money";
import { createSqliteStore } from "../store/sqlite";
import { PayPalError } from "./errors";
import { asMockRail, createMockRail, MOCK_RAIL_CALL_LOG_LIMIT, MOCK_RAIL_STATE_KEY, type MockRailState } from "./mock";

const now = () => new Date("2026-11-08T12:00:00.000Z");

async function authorized(amount = "50.00") {
  const rail = createMockRail({ baseUrl: "http://localhost:3000/", now });
  const order = await rail.createOrder({
    intent: "AUTHORIZE",
    amount: money(amount),
    description: "test",
    customId: "slip_x",
    returnUrl: "http://localhost:3000/api/paypal/return?slipId=slip_x",
    cancelUrl: "http://localhost:3000/api/paypal/cancel?slipId=slip_x",
  });
  rail.approveOrder(order.orderId, "buyer@example.com");
  const auth = await rail.authorizeOrder(order.orderId);
  return { rail, order, auth };
}

async function issue(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(PayPalError);
    return (e as PayPalError).issue;
  }
}

describe("mock rail: orders", () => {
  it("creates PayPal-looking ids and a local approve URL", async () => {
    const rail = createMockRail({ baseUrl: "http://localhost:3000/", now });
    const order = await rail.createOrder({
      intent: "CAPTURE",
      amount: money("12.00"),
      payee: { email: "seller@example.com" },
      description: "d",
      customId: "slip_y",
      returnUrl: "r",
      cancelUrl: "c",
    });
    expect(order.orderId).toMatch(/^[0-9A-Z]{17}$/);
    expect(order.approveUrl).toBe(`http://localhost:3000/mock-paypal/approve?token=${order.orderId}`);
    expect((await rail.getOrder(order.orderId)).status).toBe("CREATED");
    expect(await issue(rail.captureOrder(order.orderId))).toBe("ORDER_NOT_APPROVED");
    rail.approveOrder(order.orderId, "buyer@example.com");
    expect(await rail.getOrder(order.orderId)).toEqual({ orderId: order.orderId, status: "APPROVED", payerEmail: "buyer@example.com" });
    expect(await issue(rail.authorizeOrder(order.orderId))).toBe("ACTION_DOES_NOT_MATCH_INTENT");
    const cap = await rail.captureOrder(order.orderId);
    expect(cap.amount).toEqual(money("12.00"));
    expect((await rail.getOrder(order.orderId)).status).toBe("COMPLETED");
    expect(await issue(rail.captureOrder(order.orderId))).toBe("ORDER_ALREADY_CAPTURED");
  });

  it("cancelled orders cannot be approved", async () => {
    const rail = createMockRail({ baseUrl: "http://x", now });
    const order = await rail.createOrder({ intent: "AUTHORIZE", amount: money("5"), description: "d", customId: "s", returnUrl: "r", cancelUrl: "c" });
    rail.cancelOrder(order.orderId);
    expect(() => rail.approveOrder(order.orderId, "b@example.com")).toThrow(PayPalError);
  });
});

describe("mock rail: authorizations", () => {
  it("partially captures, then rejects over-capture", async () => {
    const { rail, auth } = await authorized("50.00");
    await rail.captureAuthorization(auth.authorizationId, { amount: money("30.00"), finalCapture: false, invoiceId: "p1" });
    expect(rail.inspectAuthorization(auth.authorizationId)?.status).toBe("PARTIALLY_CAPTURED");
    expect(await issue(rail.captureAuthorization(auth.authorizationId, { amount: money("20.01"), finalCapture: false }))).toBe(
      "MAX_CAPTURE_AMOUNT_EXCEEDED",
    );
    expect(await issue(rail.captureAuthorization(auth.authorizationId, { amount: money("1"), finalCapture: false, invoiceId: "p1" }))).toBe(
      "DUPLICATE_INVOICE_ID",
    );
    await rail.captureAuthorization(auth.authorizationId, { amount: money("20.00"), finalCapture: false });
    expect(rail.inspectAuthorization(auth.authorizationId)?.status).toBe("CAPTURED");
  });

  it("final capture closes the authorization", async () => {
    const { rail, auth } = await authorized("50.00");
    await rail.captureAuthorization(auth.authorizationId, { amount: money("10.00"), finalCapture: true });
    expect(rail.inspectAuthorization(auth.authorizationId)?.status).toBe("CAPTURED");
    expect(await issue(rail.captureAuthorization(auth.authorizationId, { amount: money("1.00"), finalCapture: false }))).toBe(
      "AUTHORIZATION_ALREADY_CAPTURED",
    );
    expect(await issue(rail.voidAuthorization(auth.authorizationId))).toBe("PREVIOUSLY_CAPTURED");
  });

  it("void blocks later captures and a second void", async () => {
    const { rail, auth } = await authorized();
    await rail.captureAuthorization(auth.authorizationId, { amount: money("5.00"), finalCapture: false });
    expect(await rail.voidAuthorization(auth.authorizationId)).toEqual({ status: "VOIDED" });
    expect(await issue(rail.captureAuthorization(auth.authorizationId, { amount: money("1.00"), finalCapture: false }))).toBe(
      "AUTHORIZATION_VOIDED",
    );
    expect(await issue(rail.voidAuthorization(auth.authorizationId))).toBe("PREVIOUSLY_VOIDED");
  });

  it("reauthorizes the remaining amount under a new id", async () => {
    const { rail, auth } = await authorized("50.00");
    await rail.captureAuthorization(auth.authorizationId, { amount: money("20.00"), finalCapture: false });
    const re = await rail.reauthorize(auth.authorizationId);
    expect(re.authorizationId).not.toBe(auth.authorizationId);
    expect(rail.inspectAuthorization(re.authorizationId)?.amount).toEqual(money("30.00"));
  });
});

describe("mock rail: refunds, payouts, tracking", () => {
  it("caps refunds at the captured amount", async () => {
    const { rail, auth } = await authorized();
    const cap = await rail.captureAuthorization(auth.authorizationId, { amount: money("30.00"), finalCapture: false });
    await rail.refundCapture(cap.captureId, { amount: money("10.00") });
    expect(rail.inspectCapture(cap.captureId)?.status).toBe("PARTIALLY_REFUNDED");
    expect(await issue(rail.refundCapture(cap.captureId, { amount: money("20.01") }))).toBe("REFUND_AMOUNT_EXCEEDED");
    await rail.refundCapture(cap.captureId, {});
    expect(rail.inspectCapture(cap.captureId)?.status).toBe("REFUNDED");
    expect(await issue(rail.refundCapture(cap.captureId, {}))).toBe("CAPTURE_FULLY_REFUNDED");
  });

  it("pays out with SUCCESS and rejects a reused sender batch id", async () => {
    const rail = createMockRail({ baseUrl: "http://x", now });
    const res = await rail.createPayout({
      senderBatchId: "slip_a-1",
      emailSubject: "s",
      items: [{ receiverEmail: "h@example.com", amount: money("15"), note: "n", senderItemId: "slip_a-1-1" }],
    });
    expect(res.status).toBe("SUCCESS");
    const got = await rail.getPayout(res.payoutBatchId);
    expect(got.items[0]).toMatchObject({ senderItemId: "slip_a-1-1", status: "SUCCESS" });
    expect(
      await issue(rail.createPayout({ senderBatchId: "slip_a-1", emailSubject: "s", items: [{ receiverEmail: "h@example.com", amount: money("15"), note: "n", senderItemId: "x" }] })),
    ).toBe("DUPLICATE_REQUEST_ID");
  });

  it("stores tracking against a capture", async () => {
    const { rail, auth, order } = await authorized();
    const cap = await rail.captureAuthorization(auth.authorizationId, { amount: money("5.00"), finalCapture: false });
    await rail.addTracking({ orderId: order.orderId, captureId: cap.captureId, trackingNumber: "1Z999", carrier: "UPS" });
    expect(rail.inspectTracking(cap.captureId)).toEqual([{ trackingNumber: "1Z999", carrier: "UPS", notifyPayer: false }]);
  });
});

describe("mock rail: seeded data and controls", () => {
  it("seeds transactions, invoices and disputes, and upserts by id", async () => {
    const rail = createMockRail({ baseUrl: "http://x", now });
    const txns = await rail.listTransactions({ startDate: "2026-08-01T00:00:00Z", endDate: "2026-11-09T00:00:00Z" });
    expect(txns.length).toBeGreaterThan(20);
    expect(txns.some((t) => t.amount.value.startsWith("-"))).toBe(true);
    const disputes = await rail.listDisputes();
    expect(disputes.length).toBe(2);
    rail.seedDisputes([{ ...disputes[0], reason: "UNAUTHORISED" }, { ...disputes[0], id: "PP-D-NEW" }]);
    const after = await rail.listDisputes();
    expect(after).toHaveLength(3);
    expect(after.find((d) => d.id === disputes[0].id)?.reason).toBe("UNAUTHORISED");
    expect(await issue(rail.getDispute("PP-D-MISSING"))).toBe("INVALID_RESOURCE_ID");
  });

  it("moves disputes through evidence and acceptance", async () => {
    const rail = createMockRail({ baseUrl: "http://x", now });
    const [d] = await rail.listDisputes();
    expect((await rail.provideEvidence(d.id, { notes: "tracking attached", evidenceType: "PROOF_OF_FULFILLMENT" })).status).toBe("UNDER_REVIEW");
    expect((await rail.acceptClaim(d.id, "refunding")).status).toBe("RESOLVED");
    expect(await issue(rail.acceptClaim(d.id, "again"))).toBe("DISPUTE_RESOLVED");
  });

  it("logs every rail call, including invoice reminders and payouts", async () => {
    const rail = createMockRail({ baseUrl: "http://x", now });
    const [inv] = (await rail.listInvoices()).filter((i) => i.status !== "PAID");
    await rail.sendInvoiceReminder(inv.id, { subject: "s", note: "n" });
    expect(rail.calls().map((c) => c.method)).toEqual(["listInvoices", "sendInvoiceReminder"]);
    expect(rail.calls()[1].args[0]).toBe(inv.id);
    expect(await rail.verifyWebhook({}, "{}")).toBe(true);
  });

  it("asMockRail recognizes only the mock", () => {
    const rail = createMockRail({ baseUrl: "http://x", now });
    expect(asMockRail(rail)).toBe(rail);
    expect(asMockRail({ ...rail, mode: "sandbox" } as never)).toBeNull();
  });

  describe("shared store", () => {
    const orderInput = {
      intent: "AUTHORIZE" as const,
      amount: money("30.00"),
      description: "shared",
      customId: "slip_s",
      returnUrl: "http://x/return",
      cancelUrl: "http://x/cancel",
    };
    const twoRails = () => {
      const store = createSqliteStore(":memory:");
      const a = createMockRail({ baseUrl: "http://x", now, store });
      const b = createMockRail({ baseUrl: "http://x", now, store });
      return { store, a, b };
    };

    it("two rails on one store act as one rail", async () => {
      const { a, b } = twoRails();
      const order = await a.createOrder(orderInput);
      expect(b.inspectOrder(order.orderId)?.status).toBe("CREATED");
      expect((await b.getOrder(order.orderId)).status).toBe("CREATED");
      b.approveOrder(order.orderId, "buyer@example.com");
      expect(a.inspectOrder(order.orderId)).toMatchObject({ status: "APPROVED", payerEmail: "buyer@example.com" });
      const auth = await a.authorizeOrder(order.orderId);
      const cap = await a.captureAuthorization(auth.authorizationId, { amount: money("30.00"), finalCapture: true, invoiceId: "INV-1" });
      expect(b.inspectAuthorization(auth.authorizationId)?.status).toBe("CAPTURED");
      expect(b.inspectCapture(cap.captureId)?.status).toBe("COMPLETED");
      await b.refundCapture(cap.captureId, { amount: money("10.00") });
      expect(a.inspectCapture(cap.captureId)).toMatchObject({ status: "PARTIALLY_REFUNDED", refundedCents: 1000 });
      expect(await issue(a.captureAuthorization(auth.authorizationId, { amount: money("1.00"), finalCapture: false }))).toBe("AUTHORIZATION_ALREADY_CAPTURED");
      const txns = await a.listTransactions({ startDate: "2026-11-08T00:00:00.000Z", endDate: "2026-11-09T00:00:00.000Z" });
      expect(txns.map((t) => t.amount.value)).toEqual(["30.00", "-10.00"]);
      expect((await b.listTransactions({ startDate: "2026-11-08T00:00:00.000Z", endDate: "2026-11-09T00:00:00.000Z" })).length).toBe(2);
    });

    it("shares dedupe sets, payouts and tracking", async () => {
      const { a, b } = twoRails();
      const payout = { senderBatchId: "batch-1", emailSubject: "s", items: [{ senderItemId: "i1", receiverEmail: "r@example.com", amount: money("5.00"), note: "n" }] };
      const res = await a.createPayout(payout);
      expect(await issue(b.createPayout(payout))).toBe("DUPLICATE_REQUEST_ID");
      expect(b.inspectPayout(res.payoutBatchId)?.items).toHaveLength(1);
      const order = await a.createOrder({ ...orderInput, intent: "CAPTURE" });
      b.approveOrder(order.orderId, "buyer@example.com");
      const cap = await a.captureOrder(order.orderId);
      await b.addTracking({ orderId: order.orderId, captureId: cap.captureId, trackingNumber: "T1", carrier: "UPS" });
      expect(a.inspectTracking(cap.captureId)).toHaveLength(1);
    });

    it("a failing call still saves what it changed before throwing, and errors stay PayPalErrors", async () => {
      const { a, b } = twoRails();
      const order = await a.createOrder(orderInput);
      expect(await issue(b.authorizeOrder(order.orderId))).toBe("ORDER_NOT_APPROVED");
      expect(a.calls().map((c) => c.method)).toEqual(["createOrder", "authorizeOrder"]);
      expect(() => b.approveOrder("NOPE", "x@example.com")).toThrow(PayPalError);
    });

    it("a second rail does not re-seed or wipe an existing doc", async () => {
      const store = createSqliteStore(":memory:");
      const a = createMockRail({ baseUrl: "http://x", now, store });
      const order = await a.createOrder(orderInput);
      a.seedInvoices([{ id: "INV-X", number: "9", status: "SENT", recipientEmail: "e@example.com", recipientName: "E", amount: money("1.00"), dueDate: "2026-12-01", issuedAt: "2026-11-01" }]);
      const before = store.collection<MockRailState>("core", "mock-rail").get(MOCK_RAIL_STATE_KEY)!;
      const b = createMockRail({ baseUrl: "http://x", now, store, seed: false });
      expect(store.collection<MockRailState>("core", "mock-rail").get(MOCK_RAIL_STATE_KEY)).toEqual(before);
      expect(b.inspectOrder(order.orderId)).not.toBeNull();
      expect((await b.listInvoices()).map((i) => i.id)).toContain("INV-X");
      expect((await b.listInvoices()).length).toBe(5);
      expect((await b.listDisputes()).length).toBe(2);
    });

    it("seeds a fresh store once, including seed:false emptiness", async () => {
      const store = createSqliteStore(":memory:");
      const empty = createMockRail({ baseUrl: "http://x", now, store, seed: false });
      expect(await empty.listDisputes()).toEqual([]);
      const later = createMockRail({ baseUrl: "http://x", now, store });
      expect(await later.listDisputes()).toEqual([]);
    });

    it("controls persist and stay deduplicated by id", async () => {
      const { a, b } = twoRails();
      const [d] = await a.listDisputes();
      a.seedDisputes([d]);
      b.seedDisputes([{ ...d, status: "UNDER_REVIEW" }]);
      const list = await a.listDisputes();
      expect(list).toHaveLength(2);
      expect(list.find((x) => x.id === d.id)?.status).toBe("UNDER_REVIEW");
      expect(b.disputeIds().sort()).toEqual(list.map((x) => x.id).sort());
      await a.acceptClaim(d.id, "ok");
      expect((await b.getDispute(d.id)).status).toBe("RESOLVED");
      b.seedTransactions([{ id: "T-1", date: "2026-11-01T00:00:00.000Z", amount: money("1.00"), counterparty: "c", note: null }]);
      b.seedTransactions([{ id: "T-1", date: "2026-11-01T00:00:00.000Z", amount: money("1.00"), counterparty: "c", note: null }]);
      const all = await a.listTransactions({ startDate: "2026-11-01T00:00:00.000Z", endDate: "2026-11-01T00:00:00.000Z" });
      expect(all.filter((t) => t.id === "T-1")).toHaveLength(1);
    });

    it("shares and bounds the call log", async () => {
      const { store, a, b } = twoRails();
      for (let i = 0; i < MOCK_RAIL_CALL_LOG_LIMIT + 20; i++) await (i % 2 ? a : b).listInvoices();
      expect(a.calls()).toHaveLength(MOCK_RAIL_CALL_LOG_LIMIT);
      expect(b.calls()).toHaveLength(MOCK_RAIL_CALL_LOG_LIMIT);
      expect(store.collection<MockRailState>("core", "mock-rail").get(MOCK_RAIL_STATE_KEY)!.callLog).toHaveLength(MOCK_RAIL_CALL_LOG_LIMIT);
    });
  });
});
