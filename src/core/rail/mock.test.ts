import { describe, expect, it } from "vitest";
import { money } from "../money";
import { PayPalError } from "./errors";
import { asMockRail, createMockRail } from "./mock";

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
});
