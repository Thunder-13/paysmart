import { describe, expect, it } from "vitest";
import { money } from "../money";
import { PayPalError } from "./errors";
import { createSandboxRail } from "./sandbox";

interface Recorded {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: unknown;
}

type Handler = (req: Recorded) => { status?: number; json?: unknown };

function stub(handlers: Record<string, Handler>) {
  const calls: Recorded[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
    let body: unknown = init?.body;
    if (typeof body === "string" && headers["content-type"] === "application/json") body = JSON.parse(body);
    const rec: Recorded = { method: init?.method ?? "GET", path: url.pathname, query: url.searchParams, headers, body };
    calls.push(rec);
    if (url.pathname === "/v1/oauth2/token") {
      return Response.json({ access_token: "TOKEN123", expires_in: 32400 });
    }
    const key = `${rec.method} ${url.pathname}`;
    const h = handlers[key];
    if (!h) return Response.json({ name: "NOT_STUBBED", message: key, debug_id: "dbg0" }, { status: 500 });
    const res = h(rec);
    if (res.status === 204) return new Response(null, { status: 204 });
    return Response.json(res.json ?? {}, { status: res.status ?? 200 });
  }) as typeof fetch;
  const rail = createSandboxRail({ clientId: "cid", clientSecret: "secret", webhookId: "WH-1", fetch: fetchImpl });
  const api = () => calls.filter((c) => c.path !== "/v1/oauth2/token");
  return { rail, calls, api };
}

describe("sandbox rail: auth", () => {
  it("gets a client-credentials token once and reuses it", async () => {
    const { rail, calls } = stub({ "GET /v2/checkout/orders/O1": () => ({ json: { id: "O1", status: "APPROVED", payer: { email_address: "b@x.com" } } }) });
    await rail.getOrder("O1");
    await rail.getOrder("O1");
    const tokenCalls = calls.filter((c) => c.path === "/v1/oauth2/token");
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0].method).toBe("POST");
    expect(tokenCalls[0].headers.authorization).toBe(`Basic ${Buffer.from("cid:secret").toString("base64")}`);
    expect(tokenCalls[0].body).toBe("grant_type=client_credentials");
    expect(calls[1].headers.authorization).toBe("Bearer TOKEN123");
  });
});

describe("sandbox rail: orders and payments", () => {
  it("creates an order with experience_context, payee and custom_id, and finds the payer-action link", async () => {
    const { rail, api } = stub({
      "POST /v2/checkout/orders": () => ({
        status: 201,
        json: { id: "5O190127TN364715T", status: "PAYER_ACTION_REQUIRED", links: [{ rel: "self", href: "x" }, { rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T" }] },
      }),
    });
    const res = await rail.createOrder({
      intent: "AUTHORIZE",
      amount: money("42.00"),
      payee: { email: "seller@example.com" },
      description: "PaySmart: a toy",
      customId: "slip_abc",
      returnUrl: "http://localhost:3000/api/paypal/return?slipId=slip_abc",
      cancelUrl: "http://localhost:3000/api/paypal/cancel?slipId=slip_abc",
    });
    expect(res).toEqual({
      orderId: "5O190127TN364715T",
      approveUrl: "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T",
      status: "PAYER_ACTION_REQUIRED",
    });
    const [call] = api();
    expect(call.method).toBe("POST");
    expect(call.headers["paypal-request-id"]).toBeTruthy();
    expect(call.headers["content-type"]).toBe("application/json");
    expect(call.body).toMatchObject({
      intent: "AUTHORIZE",
      purchase_units: [
        {
          custom_id: "slip_abc",
          description: "PaySmart: a toy",
          amount: { currency_code: "USD", value: "42.00" },
          payee: { email_address: "seller@example.com" },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            return_url: "http://localhost:3000/api/paypal/return?slipId=slip_abc",
            cancel_url: "http://localhost:3000/api/paypal/cancel?slipId=slip_abc",
            user_action: "PAY_NOW",
          },
        },
      },
    });
  });

  it("uses merchant_id when given and accepts the legacy approve link", async () => {
    const { rail, api } = stub({
      "POST /v2/checkout/orders": () => ({ json: { id: "O2", status: "CREATED", links: [{ rel: "approve", href: "https://approve" }] } }),
    });
    const res = await rail.createOrder({ intent: "CAPTURE", amount: money("5"), payee: { merchantId: "MERCH1" }, description: "d", customId: "s", returnUrl: "r", cancelUrl: "c" });
    expect(res.approveUrl).toBe("https://approve");
    expect((api()[0].body as { purchase_units: { payee: unknown }[] }).purchase_units[0].payee).toEqual({ merchant_id: "MERCH1" });
  });

  it("authorizes, captures, voids, reauthorizes and refunds with the right paths and bodies", async () => {
    const { rail, api } = stub({
      "POST /v2/checkout/orders/O1/authorize": () => ({
        json: { id: "O1", status: "COMPLETED", purchase_units: [{ payments: { authorizations: [{ id: "AUTH1", status: "CREATED", expiration_time: "2026-12-07T00:00:00Z" }] } }] },
      }),
      "POST /v2/checkout/orders/O9/capture": () => ({
        json: { id: "O9", status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: "CAPO", status: "COMPLETED", amount: { currency_code: "USD", value: "12.00" } }] } }] },
      }),
      "POST /v2/payments/authorizations/AUTH1/capture": () => ({ status: 201, json: { id: "CAP1", status: "COMPLETED" } }),
      "POST /v2/payments/authorizations/AUTH1/void": () => ({ status: 204 }),
      "POST /v2/payments/authorizations/AUTH1/reauthorize": () => ({ status: 201, json: { id: "AUTH2", status: "CREATED" } }),
      "POST /v2/payments/captures/CAP1/refund": () => ({ status: 201, json: { id: "REF1", status: "COMPLETED" } }),
    });
    expect(await rail.authorizeOrder("O1")).toEqual({ authorizationId: "AUTH1", status: "CREATED", expiresAt: "2026-12-07T00:00:00Z" });
    expect(await rail.captureOrder("O9")).toEqual({ captureId: "CAPO", status: "COMPLETED", amount: money("12.00") });
    expect(await rail.captureAuthorization("AUTH1", { amount: money("30.00"), finalCapture: false, invoiceId: "prop_1", noteToPayer: "thanks" })).toEqual({
      captureId: "CAP1",
      status: "COMPLETED",
    });
    expect(await rail.voidAuthorization("AUTH1")).toEqual({ status: "VOIDED" });
    expect(await rail.reauthorize("AUTH1", money("20"))).toEqual({ authorizationId: "AUTH2", status: "CREATED" });
    expect(await rail.refundCapture("CAP1", { amount: money("5.00"), note: "damaged" })).toEqual({ refundId: "REF1", status: "COMPLETED" });

    const calls = api();
    expect(calls.every((c) => c.method === "POST" && c.headers["paypal-request-id"])).toBe(true);
    const capture = calls.find((c) => c.path.endsWith("/AUTH1/capture"))!;
    expect(capture.body).toEqual({ amount: { currency_code: "USD", value: "30.00" }, final_capture: false, invoice_id: "prop_1", note_to_payer: "thanks" });
    expect(capture.headers["paypal-request-id"]).toBe("capture-AUTH1-prop_1");
    expect(calls.find((c) => c.path.endsWith("/reauthorize"))!.body).toEqual({ amount: { currency_code: "USD", value: "20.00" } });
    expect(calls.find((c) => c.path.endsWith("/refund"))!.body).toEqual({ amount: { currency_code: "USD", value: "5.00" }, note_to_payer: "damaged" });
  });

  it("throws PayPalError with name, issue and debug_id", async () => {
    const { rail } = stub({
      "POST /v2/payments/authorizations/AUTH1/capture": () => ({
        status: 422,
        json: {
          name: "UNPROCESSABLE_ENTITY",
          message: "The requested action could not be performed.",
          debug_id: "f00dbabe",
          details: [{ issue: "MAX_CAPTURE_AMOUNT_EXCEEDED", description: "Capture amount exceeds allowable limit." }],
        },
      }),
    });
    const err = await rail.captureAuthorization("AUTH1", { amount: money("99"), finalCapture: true }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalError);
    const e = err as PayPalError;
    expect(e.name).toBe("UNPROCESSABLE_ENTITY");
    expect(e.status).toBe(422);
    expect(e.debug_id).toBe("f00dbabe");
    expect(e.issue).toBe("MAX_CAPTURE_AMOUNT_EXCEEDED");
    expect(e.message).toContain("debug_id f00dbabe");
    expect(e.message).toContain("UNPROCESSABLE_ENTITY");
  });
});

describe("sandbox rail: payouts, tracking, reporting, invoicing", () => {
  it("sends payouts with sender ids and maps the batch", async () => {
    const { rail, api } = stub({
      "POST /v1/payments/payouts": () => ({ status: 201, json: { batch_header: { payout_batch_id: "5UXD2E8A7EBQJ", batch_status: "PENDING" } } }),
      "GET /v1/payments/payouts/5UXD2E8A7EBQJ": () => ({
        json: {
          batch_header: { payout_batch_id: "5UXD2E8A7EBQJ", batch_status: "SUCCESS" },
          items: [{ payout_item: { sender_item_id: "slip_a-1-1" }, transaction_status: "SUCCESS", transaction_id: "TX1" }],
        },
      }),
    });
    const res = await rail.createPayout({
      senderBatchId: "slip_a-1",
      emailSubject: "You have a payment",
      items: [{ receiverEmail: "hunter@example.com", amount: money("25"), note: "Bounty", senderItemId: "slip_a-1-1" }],
    });
    expect(res).toEqual({ payoutBatchId: "5UXD2E8A7EBQJ", status: "PENDING" });
    const call = api()[0];
    expect(call.headers["paypal-request-id"]).toBe("slip_a-1");
    expect(call.body).toEqual({
      sender_batch_header: { sender_batch_id: "slip_a-1", email_subject: "You have a payment", recipient_type: "EMAIL" },
      items: [{ recipient_type: "EMAIL", receiver: "hunter@example.com", amount: { currency: "USD", value: "25.00" }, note: "Bounty", sender_item_id: "slip_a-1-1" }],
    });
    expect(await rail.getPayout("5UXD2E8A7EBQJ")).toEqual({
      payoutBatchId: "5UXD2E8A7EBQJ",
      status: "SUCCESS",
      items: [{ senderItemId: "slip_a-1-1", status: "SUCCESS", transactionId: "TX1" }],
    });
  });

  it("adds tracking to an order", async () => {
    const { rail, api } = stub({ "POST /v2/checkout/orders/O1/track": () => ({ status: 201, json: { id: "O1", status: "COMPLETED" } }) });
    await rail.addTracking({ orderId: "O1", captureId: "CAP1", trackingNumber: "1Z999", carrier: "UPS", notifyPayer: true });
    expect(api()[0].body).toEqual({ capture_id: "CAP1", tracking_number: "1Z999", carrier: "UPS", notify_payer: true });
  });

  it("pages reporting transactions per 31-day window and keeps signs", async () => {
    const pages: string[] = [];
    const { rail, api } = stub({
      "GET /v1/reporting/transactions": (req) => {
        pages.push(`${req.query.get("start_date")}|${req.query.get("page")}`);
        const page = Number(req.query.get("page"));
        return {
          json: {
            total_pages: 2,
            transaction_details: [
              {
                transaction_info: { transaction_id: `T${pages.length}`, transaction_initiation_date: "2026-10-01T10:00:00+0000", transaction_amount: { currency_code: "USD", value: page === 1 ? "-12.5" : "40.00" } },
                payer_info: page === 1 ? { email_address: "a@example.com" } : { payer_name: { alternate_full_name: "Bea Payer" } },
              },
            ],
          },
        };
      },
    });
    const txns = await rail.listTransactions({ startDate: "2026-09-01T00:00:00Z", endDate: "2026-10-15T00:00:00Z" });
    expect(api().every((c) => c.query.get("fields") === "all" && c.query.get("page_size") === "500")).toBe(true);
    expect(pages).toHaveLength(4); // two windows x two pages
    expect(txns[0]).toMatchObject({ amount: { currency: "USD", value: "-12.50" }, counterparty: "a@example.com" });
    expect(txns[1]).toMatchObject({ amount: { value: "40.00" }, counterparty: "Bea Payer" });
  });

  it("surfaces PayPal's error name for a missing Transaction search permission", async () => {
    const { rail } = stub({
      "GET /v1/reporting/transactions": () => ({ status: 403, json: { name: "NOT_AUTHORIZED", message: "Authorization failed due to insufficient permissions.", debug_id: "abc" } }),
    });
    await expect(rail.listTransactions({ startDate: "2026-10-01T00:00:00Z", endDate: "2026-10-02T00:00:00Z" })).rejects.toThrow(/NOT_AUTHORIZED/);
  });

  it("lists invoices and sends reminders", async () => {
    const { rail, api } = stub({
      "GET /v2/invoicing/invoices": () => ({
        json: {
          items: [
            {
              id: "INV2-AAAA",
              status: "SENT",
              detail: { invoice_number: "0042", invoice_date: "2026-10-01", payment_term: { due_date: "2026-10-31" }, currency_code: "USD" },
              primary_recipients: [{ billing_info: { email_address: "c@example.com", name: { given_name: "Cy", surname: "Lee" } } }],
              amount: { currency_code: "USD", value: "120.00" },
            },
          ],
        },
      }),
      "POST /v2/invoicing/invoices/INV2-AAAA/remind": () => ({ status: 204 }),
    });
    expect(await rail.listInvoices()).toEqual([
      { id: "INV2-AAAA", number: "0042", status: "SENT", recipientEmail: "c@example.com", recipientName: "Cy Lee", amount: money("120"), dueDate: "2026-10-31", issuedAt: "2026-10-01" },
    ]);
    await rail.sendInvoiceReminder("INV2-AAAA", { subject: "Friendly nudge", note: "Due soon" });
    expect(api()[1].body).toEqual({ subject: "Friendly nudge", note: "Due soon", send_to_invoicer: false, send_to_recipient: true });
  });
});

describe("sandbox rail: disputes and webhooks", () => {
  const disputeJson = {
    dispute_id: "PP-D-1",
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    status: "UNDER_REVIEW",
    dispute_amount: { currency_code: "USD", value: "86.40" },
    create_time: "2026-11-05T00:00:00Z",
    seller_response_due_date: "2026-11-15T00:00:00Z",
    disputed_transactions: [{ seller_transaction_id: "CAP1", buyer: { name: "Bo" } }],
    messages: [{ posted_by: "BUYER", content: "Never arrived" }],
  };

  it("maps disputes and uploads evidence as multipart", async () => {
    const { rail, api } = stub({
      "GET /v1/customer/disputes": () => ({ json: { items: [{ dispute_id: "PP-D-1", reason: "UNAUTHORISED", status: "OPEN", dispute_amount: { currency_code: "USD", value: "1.00" }, create_time: "t" }] } }),
      "GET /v1/customer/disputes/PP-D-1": () => ({ json: disputeJson }),
      "POST /v1/customer/disputes/PP-D-1/provide-evidence": () => ({ json: { links: [] } }),
      "POST /v1/customer/disputes/PP-D-1/accept-claim": () => ({ json: { links: [] } }),
    });
    expect((await rail.listDisputes())[0].id).toBe("PP-D-1");
    const d = await rail.getDispute("PP-D-1");
    expect(d).toMatchObject({ transactionId: "CAP1", amount: money("86.40"), messages: ["Never arrived"], sellerResponseDueAt: "2026-11-15T00:00:00Z" });

    const res = await rail.provideEvidence("PP-D-1", {
      notes: "Tracking shows delivered",
      evidenceType: "PROOF_OF_FULFILLMENT",
      documents: [{ name: "ledger.json", contentType: "application/json", base64: Buffer.from("{}").toString("base64") }],
    });
    expect(res.status).toBe("UNDER_REVIEW");
    const upload = api().find((c) => c.path.endsWith("/provide-evidence"))!;
    expect(upload.body).toBeInstanceOf(FormData);
    expect(upload.headers["content-type"]).toBeUndefined();
    const form = upload.body as FormData;
    const input = JSON.parse(await (form.get("input") as Blob).text());
    expect(input).toEqual({ evidences: [{ evidence_type: "PROOF_OF_FULFILLMENT", notes: "Tracking shows delivered", documents: [{ name: "ledger.json" }] }] });
    expect((form.getAll("evidence-file")[0] as File).name).toBe("ledger.json");

    await rail.acceptClaim("PP-D-1", "Refunding in full");
    expect(api().find((c) => c.path.endsWith("/accept-claim"))!.body).toEqual({ note: "Refunding in full" });
  });

  it("verifies webhook signatures with PayPal", async () => {
    const { rail, api } = stub({
      "POST /v1/notifications/verify-webhook-signature": () => ({ json: { verification_status: "SUCCESS" } }),
    });
    const ok = await rail.verifyWebhook(
      {
        "PAYPAL-AUTH-ALGO": "SHA256withRSA",
        "paypal-cert-url": "https://api.sandbox.paypal.com/cert",
        "paypal-transmission-id": "tid",
        "paypal-transmission-sig": "sig",
        "paypal-transmission-time": "2026-11-08T00:00:00Z",
      },
      JSON.stringify({ id: "WH-EVT", event_type: "PAYMENT.CAPTURE.REFUNDED" }),
    );
    expect(ok).toBe(true);
    expect(api()[0].body).toEqual({
      auth_algo: "SHA256withRSA",
      cert_url: "https://api.sandbox.paypal.com/cert",
      transmission_id: "tid",
      transmission_sig: "sig",
      transmission_time: "2026-11-08T00:00:00Z",
      webhook_id: "WH-1",
      webhook_event: { id: "WH-EVT", event_type: "PAYMENT.CAPTURE.REFUNDED" },
    });
    expect(await rail.verifyWebhook({}, "not json")).toBe(false);
  });
});
