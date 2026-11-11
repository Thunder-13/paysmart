/**
 * PayPal REST client (sandbox by default). Plain fetch, no SDK.
 * OAuth2 client-credentials with a cached token, PayPal-Request-Id on every POST,
 * PayPalError (name, message, debug_id, status) on any non-2xx response.
 * This module never writes ledger events; CoreServices does that.
 */
import type { Money, PayPalRail, RailDispute, RailInvoice, RailTransaction } from "../contracts";
import { clipText } from "./clip";
import { PayPalError } from "./errors";

export { PayPalError } from "./errors";

export interface SandboxRailOptions {
  clientId: string;
  clientSecret: string;
  webhookId: string;
  baseUrl?: string;
  /** Injected for tests. Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
  now?: () => Date;
}

type Json = Record<string, unknown>;

interface RequestOptions {
  body?: unknown;
  form?: FormData;
  query?: Record<string, string | number | boolean | undefined>;
  requestId?: string;
}

function asObj(v: unknown): Json {
  return v && typeof v === "object" ? (v as Json) : {};
}
function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/** PayPal amounts come as {currency_code, value} (Orders/Payments) or {currency, value} (Payouts). */
function readMoney(v: unknown, fallbackCurrency = "USD"): Money {
  const o = asObj(v);
  const currency = str(o.currency_code) ?? str(o.currency) ?? fallbackCurrency;
  const raw = str(o.value) ?? "0";
  const n = raw.trim();
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(n);
  if (!m) return { currency, value: "0.00" };
  const frac = (m[3] ?? "").padEnd(2, "0").slice(0, 2);
  return { currency, value: `${m[1] ?? ""}${m[2]}.${frac}` };
}

function wireAmount(m: Money): { currency_code: string; value: string } {
  return { currency_code: m.currency, value: m.value };
}

function randomRequestId(): string {
  return globalThis.crypto.randomUUID();
}

/** Split [start, end] into windows of at most 31 days (the Reporting API limit). */
function windows(startIso: string, endIso: string): Array<[string, string]> {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return [[startIso, endIso]];
  const out: Array<[string, string]> = [];
  const step = 31 * 86_400_000 - 1000;
  for (let s = start; s < end; s += step + 1000) {
    const e = Math.min(end, s + step);
    out.push([new Date(s).toISOString().replace(/\.\d{3}Z$/, "Z"), new Date(e).toISOString().replace(/\.\d{3}Z$/, "Z")]);
  }
  return out;
}

function mapDispute(raw: unknown): RailDispute {
  const d = asObj(raw);
  const txns = asArr(d.disputed_transactions).map(asObj);
  const firstTxn = txns[0] ?? {};
  const buyer = asObj(firstTxn.buyer);
  const messages = asArr(d.messages)
    .map(asObj)
    .map((m) => str(m.content))
    .filter((x): x is string => x !== null);
  return {
    id: str(d.dispute_id) ?? "",
    reason: str(d.reason) ?? "UNKNOWN",
    status: str(d.status) ?? "UNKNOWN",
    amount: readMoney(d.dispute_amount),
    createdAt: str(d.create_time) ?? new Date(0).toISOString(),
    sellerResponseDueAt: str(d.seller_response_due_date),
    transactionId: str(firstTxn.seller_transaction_id) ?? str(firstTxn.buyer_transaction_id),
    buyerEmail: str(buyer.email) ?? str(buyer.email_address),
    messages,
  };
}

function mapInvoice(raw: unknown): RailInvoice {
  const i = asObj(raw);
  const detail = asObj(i.detail);
  const term = asObj(detail.payment_term);
  const recipient = asObj(asArr(i.primary_recipients)[0]);
  const billing = asObj(recipient.billing_info);
  const name = asObj(billing.name);
  const fullName = str(name.full_name) ?? ([str(name.given_name), str(name.surname)].filter(Boolean).join(" ") || null);
  const metadata = asObj(detail.metadata);
  return {
    id: str(i.id) ?? "",
    number: str(detail.invoice_number) ?? "",
    status: str(i.status) ?? "UNKNOWN",
    recipientEmail: str(billing.email_address) ?? "",
    recipientName: fullName,
    amount: readMoney(i.amount, str(detail.currency_code) ?? "USD"),
    dueDate: str(term.due_date),
    issuedAt: str(detail.invoice_date) ?? (str(metadata.create_time) ?? "").slice(0, 10),
  };
}

function mapTransaction(raw: unknown): RailTransaction {
  const t = asObj(raw);
  const info = asObj(t.transaction_info);
  const payer = asObj(t.payer_info);
  const payerName = asObj(payer.payer_name);
  return {
    id: str(info.transaction_id) ?? "",
    date: str(info.transaction_initiation_date) ?? str(info.transaction_updated_date) ?? "",
    // Reporting amounts are already signed: negative is money out.
    amount: readMoney(info.transaction_amount),
    counterparty: str(payer.email_address) ?? str(payerName.alternate_full_name) ?? "unknown",
    note: str(info.transaction_note) ?? str(info.transaction_subject) ?? null,
  };
}

export function createSandboxRail(opts: SandboxRailOptions): PayPalRail {
  const baseUrl = (opts.baseUrl ?? "https://api-m.sandbox.paypal.com").replace(/\/+$/, "");
  const doFetch: typeof fetch = opts.fetch ?? ((...args) => globalThis.fetch(...args));
  const now = opts.now ?? (() => new Date());
  let token: { value: string; expiresAt: number } | null = null;
  let pendingToken: Promise<string> | null = null;

  async function readError(res: Response): Promise<PayPalError> {
    let body: Json = {};
    try {
      body = asObj(await res.json());
    } catch {
      body = {};
    }
    const details = asArr(body.details).map((d) => {
      const o = asObj(d);
      return { issue: str(o.issue) ?? "UNKNOWN", description: str(o.description) ?? undefined, field: str(o.field) ?? undefined };
    });
    return new PayPalError({
      name: str(body.name) ?? str(body.error) ?? `HTTP_${res.status}`,
      message: str(body.message) ?? str(body.error_description) ?? res.statusText ?? "PayPal request failed",
      debug_id: str(body.debug_id) ?? res.headers.get("paypal-debug-id"),
      status: res.status,
      details,
    });
  }

  async function accessToken(): Promise<string> {
    if (token && token.expiresAt > now().getTime()) return token.value;
    if (pendingToken) return pendingToken;
    pendingToken = (async () => {
      const basic = Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString("base64");
      const res = await doFetch(`${baseUrl}/v1/oauth2/token`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: "grant_type=client_credentials",
      });
      if (!res.ok) throw await readError(res);
      const body = asObj(await res.json());
      const value = str(body.access_token);
      if (!value) throw new PayPalError({ name: "AUTHENTICATION_FAILURE", message: "No access_token in OAuth response", debug_id: null, status: res.status });
      const ttl = typeof body.expires_in === "number" ? body.expires_in : 300;
      token = { value, expiresAt: now().getTime() + Math.max(0, ttl - 60) * 1000 };
      return value;
    })();
    try {
      return await pendingToken;
    } finally {
      pendingToken = null;
    }
  }

  async function call(method: "GET" | "POST", path: string, ro: RequestOptions = {}): Promise<unknown> {
    const url = new URL(`${baseUrl}${path}`);
    for (const [k, v] of Object.entries(ro.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await accessToken()}`,
      Accept: "application/json",
    };
    let body: string | FormData | undefined;
    if (method === "POST") {
      headers["PayPal-Request-Id"] = ro.requestId ?? randomRequestId();
      if (ro.form) {
        body = ro.form; // fetch sets the multipart boundary
      } else {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(ro.body ?? {});
      }
    }
    const res = await doFetch(url.toString(), { method, headers, body });
    if (!res.ok) throw await readError(res);
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? (JSON.parse(text) as unknown) : null;
  }

  async function disputeStatus(id: string, fallback: string): Promise<string> {
    try {
      const d = asObj(await call("GET", `/v1/customer/disputes/${encodeURIComponent(id)}`));
      return str(d.status) ?? fallback;
    } catch {
      return fallback;
    }
  }

  return {
    mode: "sandbox",

    async createOrder(input) {
      const payee = input.payee?.merchantId
        ? { merchant_id: input.payee.merchantId }
        : input.payee?.email
          ? { email_address: input.payee.email }
          : undefined;
      const body = {
        intent: input.intent,
        purchase_units: [
          {
            reference_id: input.customId.slice(0, 256),
            custom_id: input.customId.slice(0, 127),
            description: clipText(input.description),
            amount: wireAmount(input.amount),
            ...(payee ? { payee } : {}),
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: "PaySmart",
              user_action: "PAY_NOW",
              shipping_preference: "NO_SHIPPING",
              return_url: input.returnUrl,
              cancel_url: input.cancelUrl,
            },
          },
        },
      };
      const res = asObj(await call("POST", "/v2/checkout/orders", { body }));
      const links = asArr(res.links).map(asObj);
      const approve = links.find((l) => l.rel === "payer-action") ?? links.find((l) => l.rel === "approve");
      const approveUrl = str(approve?.href);
      if (!approveUrl) {
        throw new PayPalError({ name: "MISSING_APPROVE_LINK", message: "PayPal returned no payer-action link", debug_id: null, status: 200 });
      }
      return { orderId: str(res.id) ?? "", approveUrl, status: str(res.status) ?? "CREATED" };
    },

    async getOrder(orderId) {
      const res = asObj(await call("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`));
      const payer = asObj(res.payer);
      const source = asObj(asObj(res.payment_source).paypal);
      return {
        orderId: str(res.id) ?? orderId,
        status: str(res.status) ?? "UNKNOWN",
        payerEmail: str(payer.email_address) ?? str(source.email_address),
      };
    },

    async authorizeOrder(orderId) {
      const res = asObj(await call("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, { body: {} }));
      const unit = asObj(asArr(res.purchase_units)[0]);
      const a = asObj(asArr(asObj(unit.payments).authorizations)[0]);
      return { authorizationId: str(a.id) ?? "", status: str(a.status) ?? str(res.status) ?? "CREATED", expiresAt: str(a.expiration_time) };
    },

    async captureOrder(orderId) {
      const res = asObj(await call("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { body: {} }));
      const unit = asObj(asArr(res.purchase_units)[0]);
      const c = asObj(asArr(asObj(unit.payments).captures)[0]);
      return { captureId: str(c.id) ?? "", status: str(c.status) ?? "COMPLETED", amount: readMoney(c.amount) };
    },

    async captureAuthorization(authorizationId, input) {
      const body: Json = { amount: wireAmount(input.amount), final_capture: input.finalCapture };
      if (input.invoiceId) body.invoice_id = input.invoiceId.slice(0, 127);
      if (input.noteToPayer) body.note_to_payer = input.noteToPayer.slice(0, 255);
      const res = asObj(
        await call("POST", `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`, {
          body,
          // Same proposal, same request id: a retried capture cannot double-charge.
          requestId: input.invoiceId ? `capture-${authorizationId}-${input.invoiceId}`.slice(0, 108) : undefined,
        }),
      );
      return { captureId: str(res.id) ?? "", status: str(res.status) ?? "COMPLETED" };
    },

    async voidAuthorization(authorizationId) {
      await call("POST", `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`, { body: {} });
      return { status: "VOIDED" };
    },

    async reauthorize(authorizationId, amount) {
      const res = asObj(
        await call("POST", `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/reauthorize`, {
          body: amount ? { amount: wireAmount(amount) } : {},
        }),
      );
      return { authorizationId: str(res.id) ?? "", status: str(res.status) ?? "CREATED" };
    },

    async refundCapture(captureId, input) {
      const body: Json = {};
      if (input.amount) body.amount = wireAmount(input.amount);
      if (input.note) body.note_to_payer = input.note.slice(0, 255);
      const res = asObj(await call("POST", `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, { body }));
      return { refundId: str(res.id) ?? "", status: str(res.status) ?? "COMPLETED" };
    },

    async createPayout(input) {
      const body = {
        sender_batch_header: { sender_batch_id: input.senderBatchId, email_subject: input.emailSubject, recipient_type: "EMAIL" },
        items: input.items.map((it) => ({
          recipient_type: "EMAIL",
          receiver: it.receiverEmail,
          amount: { currency: it.amount.currency, value: it.amount.value },
          note: it.note,
          sender_item_id: it.senderItemId,
        })),
      };
      const res = asObj(await call("POST", "/v1/payments/payouts", { body, requestId: input.senderBatchId }));
      const header = asObj(res.batch_header);
      return { payoutBatchId: str(header.payout_batch_id) ?? "", status: str(header.batch_status) ?? "PENDING" };
    },

    async getPayout(payoutBatchId) {
      const res = asObj(await call("GET", `/v1/payments/payouts/${encodeURIComponent(payoutBatchId)}`));
      const header = asObj(res.batch_header);
      return {
        payoutBatchId: str(header.payout_batch_id) ?? payoutBatchId,
        status: str(header.batch_status) ?? "UNKNOWN",
        items: asArr(res.items)
          .map(asObj)
          .map((i) => ({
            senderItemId: str(asObj(i.payout_item).sender_item_id) ?? "",
            status: str(i.transaction_status) ?? "UNKNOWN",
            transactionId: str(i.transaction_id),
          })),
      };
    },

    async addTracking(input) {
      const res = asObj(
        await call("POST", `/v2/checkout/orders/${encodeURIComponent(input.orderId)}/track`, {
          body: {
            capture_id: input.captureId,
            tracking_number: input.trackingNumber,
            carrier: input.carrier,
            notify_payer: input.notifyPayer ?? false,
          },
        }),
      );
      return { status: str(res.status) ?? "SHIPPED" };
    },

    async listTransactions(input) {
      const out: RailTransaction[] = [];
      for (const [start, end] of windows(input.startDate, input.endDate)) {
        for (let page = 1; page <= 20; page++) {
          const res = asObj(
            await call("GET", "/v1/reporting/transactions", {
              query: { start_date: start, end_date: end, fields: "all", page_size: 500, page },
            }),
          );
          out.push(...asArr(res.transaction_details).map(mapTransaction));
          const total = typeof res.total_pages === "number" ? res.total_pages : 1;
          if (page >= total) break;
        }
      }
      return out;
    },

    async listInvoices() {
      const res = asObj(await call("GET", "/v2/invoicing/invoices", { query: { page: 1, page_size: 100, total_required: true } }));
      return asArr(res.items).map(mapInvoice);
    },

    async sendInvoiceReminder(invoiceId, input) {
      await call("POST", `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/remind`, {
        body: { subject: input.subject, note: input.note, send_to_invoicer: false, send_to_recipient: true },
      });
      return { status: "SENT" };
    },

    async listDisputes() {
      const res = asObj(await call("GET", "/v1/customer/disputes", { query: { page_size: 50 } }));
      return asArr(res.items).map(mapDispute);
    },

    async getDispute(disputeId) {
      return mapDispute(await call("GET", `/v1/customer/disputes/${encodeURIComponent(disputeId)}`));
    },

    async provideEvidence(disputeId, input) {
      const docs = input.documents ?? [];
      const form = new FormData();
      const payload = {
        evidences: [
          {
            evidence_type: input.evidenceType ?? "OTHER",
            notes: input.notes.slice(0, 2000),
            documents: docs.map((d) => ({ name: d.name })),
          },
        ],
      };
      form.append("input", new Blob([JSON.stringify(payload)], { type: "application/json" }), "input.json");
      for (const d of docs) {
        form.append("evidence-file", new Blob([Buffer.from(d.base64, "base64")], { type: d.contentType }), d.name);
      }
      await call("POST", `/v1/customer/disputes/${encodeURIComponent(disputeId)}/provide-evidence`, { form });
      return { status: await disputeStatus(disputeId, "UNDER_REVIEW") };
    },

    async acceptClaim(disputeId, note) {
      await call("POST", `/v1/customer/disputes/${encodeURIComponent(disputeId)}/accept-claim`, {
        body: { note: note.slice(0, 2000) },
      });
      return { status: await disputeStatus(disputeId, "RESOLVED") };
    },

    async verifyWebhook(headers, rawBody) {
      if (!opts.webhookId) return false;
      const h: Record<string, string> = {};
      for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = v;
      let event: unknown;
      try {
        event = JSON.parse(rawBody);
      } catch {
        return false;
      }
      const res = asObj(
        await call("POST", "/v1/notifications/verify-webhook-signature", {
          body: {
            auth_algo: h["paypal-auth-algo"],
            cert_url: h["paypal-cert-url"],
            transmission_id: h["paypal-transmission-id"],
            transmission_sig: h["paypal-transmission-sig"],
            transmission_time: h["paypal-transmission-time"],
            webhook_id: opts.webhookId,
            webhook_event: event,
          },
        }),
      );
      return res.verification_status === "SUCCESS";
    },
  };
}
