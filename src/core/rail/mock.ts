/**
 * Offline PayPal rail. Same interface as the sandbox client, with a realistic state machine:
 *   orders          CREATED -> APPROVED (approveOrder) -> COMPLETED   (cancelOrder -> VOIDED)
 *   authorizations  CREATED -> PARTIALLY_CAPTURED -> CAPTURED | VOIDED
 *   captures        COMPLETED -> PARTIALLY_REFUNDED -> REFUNDED
 * Errors are PayPalError with the issue codes PayPal uses for the same mistakes.
 */
import type {
  Money,
  MockRailControls,
  PayPalRail,
  RailDispute,
  RailInvoice,
  RailTransaction,
  Store,
} from "../contracts";
import { randomToken } from "../ids";
import { fromCents, toCents } from "../money";
import { clipText } from "./clip";
import { PayPalError } from "./errors";

const UPPER = "0123456789ABCDEFGHJKLMNPRSTUVWXY";

function paypalId(length = 17): string {
  return randomToken(length, UPPER);
}

export interface MockOrder {
  id: string;
  intent: "AUTHORIZE" | "CAPTURE";
  amount: Money;
  payee: { email?: string; merchantId?: string } | null;
  description: string;
  customId: string;
  returnUrl: string;
  cancelUrl: string;
  status: "CREATED" | "APPROVED" | "COMPLETED" | "VOIDED";
  payerEmail: string | null;
  authorizationId: string | null;
  captureId: string | null;
  createdAt: string;
}

export interface MockAuthorization {
  id: string;
  orderId: string;
  amount: Money;
  capturedCents: number;
  status: "CREATED" | "PARTIALLY_CAPTURED" | "CAPTURED" | "VOIDED";
  expiresAt: string;
}

export interface MockCapture {
  id: string;
  authorizationId: string | null;
  orderId: string;
  amount: Money;
  refundedCents: number;
  status: "COMPLETED" | "PARTIALLY_REFUNDED" | "REFUNDED";
  invoiceId: string | null;
}

export interface MockPayout {
  payoutBatchId: string;
  senderBatchId: string;
  status: string;
  items: { senderItemId: string; receiverEmail: string; amount: Money; note: string; status: string; transactionId: string | null }[];
}

export interface MockRailInspect {
  inspectOrder(orderId: string): MockOrder | null;
  inspectAuthorization(authorizationId: string): MockAuthorization | null;
  inspectCapture(captureId: string): MockCapture | null;
  inspectPayout(payoutBatchId: string): MockPayout | null;
  inspectTracking(captureId: string): { trackingNumber: string; carrier: string; notifyPayer: boolean }[];
  /** Ids of the disputes on the rail right now (restoreDemoDisputes uses it to avoid overwriting live state). */
  disputeIds(): string[];
}

/** The whole rail state as one JSON document, persisted when createMockRail gets a store. */
export interface MockRailState {
  version: 1;
  orders: MockOrder[];
  auths: MockAuthorization[];
  captures: MockCapture[];
  refunds: { id: string; captureId: string; amount: Money }[];
  payouts: MockPayout[];
  senderBatchIds: string[];
  invoiceIdsUsed: string[];
  tracking: [string, { trackingNumber: string; carrier: string; notifyPayer: boolean }[]][];
  seededTransactions: RailTransaction[];
  liveTransactions: RailTransaction[];
  invoices: RailInvoice[];
  disputes: RailDispute[];
  callLog: { method: string; args: unknown[]; at: string }[];
}

export const MOCK_RAIL_STATE_KEY = "state";
/** Newest call-log entries kept in the persisted doc. */
export const MOCK_RAIL_CALL_LOG_LIMIT = 200;

export type MockRail = PayPalRail & MockRailControls & MockRailInspect;

/** PayPalRail methods that the call log records (mock-only controls are not logged). */
const RAIL_METHODS = [
  "createOrder",
  "getOrder",
  "authorizeOrder",
  "captureOrder",
  "captureAuthorization",
  "voidAuthorization",
  "reauthorize",
  "refundCapture",
  "createPayout",
  "getPayout",
  "addTracking",
  "listTransactions",
  "listInvoices",
  "sendInvoiceReminder",
  "listDisputes",
  "getDispute",
  "provideEvidence",
  "acceptClaim",
  "verifyWebhook",
] as const;

/** The mock controls when `rail` is the mock rail, otherwise null (sandbox mode). */
export function asMockRail(rail: PayPalRail): MockRail | null {
  const r = rail as Partial<MockRail>;
  return rail.mode === "mock" && typeof r.approveOrder === "function" && typeof r.inspectOrder === "function"
    ? (rail as MockRail)
    : null;
}

function upsertById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const out = [...current];
  for (const item of incoming) {
    const i = out.findIndex((x) => x.id === item.id);
    if (i >= 0) out[i] = item;
    else out.push(item);
  }
  return out;
}

function fail(status: number, name: string, message: string, issue: string, description?: string): never {
  throw new PayPalError({
    name,
    message,
    status,
    debug_id: `mock-${randomToken(10)}`,
    details: [{ issue, description }],
  });
}

function unprocessable(issue: string, description: string): never {
  fail(422, "UNPROCESSABLE_ENTITY", "The requested action could not be performed, semantically incorrect, or failed business validation.", issue, description);
}

function notFound(what: string, id: string): never {
  fail(404, "RESOURCE_NOT_FOUND", "The specified resource does not exist.", "INVALID_RESOURCE_ID", `${what} ${id} was not found.`);
}

function assertPositive(m: Money): void {
  let cents: number;
  try {
    cents = toCents(m);
  } catch {
    fail(400, "INVALID_REQUEST", "Request is not well-formed, syntactically incorrect, or violates schema.", "INVALID_PARAMETER_VALUE", "amount.value is not a valid amount");
  }
  if (cents <= 0) {
    fail(400, "INVALID_REQUEST", "Request is not well-formed, syntactically incorrect, or violates schema.", "AMOUNT_MUST_BE_POSITIVE", "amount.value must be greater than zero");
  }
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Small deterministic PRNG so the seed data is the same on every boot. */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function defaultSeed(now: Date): { transactions: RailTransaction[]; invoices: RailInvoice[]; disputes: RailDispute[] } {
  const rand = prng(20261112);
  const customers = ["Maple Street Bakery", "Northside Yoga", "Dana Whitfield", "Copperline Studio", "R. Okafor", "Juniper Kids Club"];
  const vendors = ["Hosting (Fly Metro)", "Adobe Creative", "Contractor: J. Ruiz", "Office lease", "Coffee supplier"];
  const transactions: RailTransaction[] = [];
  for (let day = 89; day >= 1; day--) {
    const date = addDays(now, -day);
    if (rand() < 0.55) {
      const cents = 4500 + Math.floor(rand() * 42000);
      transactions.push({
        id: `MOCKTX${String(day).padStart(3, "0")}IN${transactions.length}`,
        date: date.toISOString(),
        amount: fromCents(cents, "USD"),
        counterparty: customers[Math.floor(rand() * customers.length)],
        note: "Invoice payment",
      });
    }
    if (rand() < 0.3 || day % 30 === 3) {
      const rent = day % 30 === 3;
      const cents = rent ? 180000 : 1500 + Math.floor(rand() * 24000);
      transactions.push({
        id: `MOCKTX${String(day).padStart(3, "0")}OUT${transactions.length}`,
        date: date.toISOString(),
        amount: fromCents(-cents, "USD"),
        counterparty: rent ? "Office lease" : vendors[Math.floor(rand() * vendors.length)],
        note: rent ? "Monthly rent" : null,
      });
    }
  }
  const invoices: RailInvoice[] = [
    {
      id: "INV2-MOCK-7Q3D-A1B2",
      number: "0042",
      status: "SENT",
      recipientEmail: "accounts@maplestreetbakery.example",
      recipientName: "Maple Street Bakery",
      amount: { currency: "USD", value: "1250.00" },
      dueDate: isoDay(addDays(now, -9)),
      issuedAt: isoDay(addDays(now, -39)),
    },
    {
      id: "INV2-MOCK-8H4K-C3D4",
      number: "0043",
      status: "UNPAID",
      recipientEmail: "dana.whitfield@example.com",
      recipientName: "Dana Whitfield",
      amount: { currency: "USD", value: "480.00" },
      dueDate: isoDay(addDays(now, 6)),
      issuedAt: isoDay(addDays(now, -24)),
    },
    {
      id: "INV2-MOCK-9J5L-E5F6",
      number: "0044",
      status: "PARTIALLY_PAID",
      recipientEmail: "studio@copperline.example",
      recipientName: "Copperline Studio",
      amount: { currency: "USD", value: "2100.00" },
      dueDate: isoDay(addDays(now, -2)),
      issuedAt: isoDay(addDays(now, -32)),
    },
    {
      id: "INV2-MOCK-0K6M-G7H8",
      number: "0041",
      status: "PAID",
      recipientEmail: "hello@northsideyoga.example",
      recipientName: "Northside Yoga",
      amount: { currency: "USD", value: "640.00" },
      dueDate: isoDay(addDays(now, -20)),
      issuedAt: isoDay(addDays(now, -50)),
    },
  ];
  const disputes: RailDispute[] = [
    {
      id: "PP-D-MOCK-48213",
      reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
      status: "WAITING_FOR_SELLER_RESPONSE",
      amount: { currency: "USD", value: "86.40" },
      createdAt: addDays(now, -3).toISOString(),
      sellerResponseDueAt: addDays(now, 7).toISOString(),
      transactionId: null,
      buyerEmail: "buyer@example.com",
      messages: ["I never got the order. Tracking says delivered but nothing was at my door."],
    },
    {
      id: "PP-D-MOCK-48377",
      reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
      status: "WAITING_FOR_SELLER_RESPONSE",
      amount: { currency: "USD", value: "42.18" },
      createdAt: addDays(now, -1).toISOString(),
      sellerResponseDueAt: addDays(now, 9).toISOString(),
      transactionId: null,
      buyerEmail: "jamie.lee@example.com",
      messages: ["The listing said no batteries needed. The toy needs 3 AA batteries."],
    },
  ];
  return { transactions, invoices, disputes };
}

export function createMockRail(opts: {
  baseUrl: string;
  now?: () => Date;
  seed?: boolean;
  /**
   * Shared state. With a store, every public rail, control and inspect call loads the latest
   * `core/mock-rail` doc first and saves it afterwards, so several server instances act as one rail
   * (last writer wins). Seeding happens only when no doc exists yet. Without a store the state lives
   * in this closure only.
   */
  store?: Store;
}): MockRail {
  const now = opts.now ?? (() => new Date());
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");
  const orders = new Map<string, MockOrder>();
  const auths = new Map<string, MockAuthorization>();
  const captures = new Map<string, MockCapture>();
  const refunds = new Map<string, { id: string; captureId: string; amount: Money }>();
  const payouts = new Map<string, MockPayout>();
  const senderBatchIds = new Set<string>();
  const invoiceIdsUsed = new Set<string>();
  const tracking = new Map<string, { trackingNumber: string; carrier: string; notifyPayer: boolean }[]>();
  const seed = opts.seed === false ? { transactions: [], invoices: [], disputes: [] } : defaultSeed(now());
  let seededTransactions: RailTransaction[] = seed.transactions;
  /** Money that moved through this rail (captures in, refunds and payouts out). */
  let liveTransactions: RailTransaction[] = [];
  let invoices: RailInvoice[] = seed.invoices;
  let disputes: RailDispute[] = seed.disputes;
  let callLog: { method: string; args: unknown[]; at: string }[] = [];

  function order(id: string): MockOrder {
    return orders.get(id) ?? notFound("Order", id);
  }
  function auth(id: string): MockAuthorization {
    return auths.get(id) ?? notFound("Authorization", id);
  }
  function capture(id: string): MockCapture {
    return captures.get(id) ?? notFound("Capture", id);
  }
  function dispute(id: string): RailDispute {
    return disputes.find((d) => d.id === id) ?? notFound("Dispute", id);
  }
  function record(amountCents: number, currency: string, counterparty: string, note: string | null): void {
    liveTransactions.push({
      id: paypalId(),
      date: now().toISOString(),
      amount: fromCents(amountCents, currency),
      counterparty,
      note,
    });
  }

  const rail: MockRail = {
    mode: "mock",

    async createOrder(input) {
      assertPositive(input.amount);
      const id = paypalId();
      orders.set(id, {
        id,
        intent: input.intent,
        amount: { ...input.amount },
        payee: input.payee ?? null,
        description: clipText(input.description),
        customId: input.customId,
        returnUrl: input.returnUrl,
        cancelUrl: input.cancelUrl,
        status: "CREATED",
        payerEmail: null,
        authorizationId: null,
        captureId: null,
        createdAt: now().toISOString(),
      });
      return { orderId: id, approveUrl: `${baseUrl}/mock-paypal/approve?token=${id}`, status: "PAYER_ACTION_REQUIRED" };
    },

    async getOrder(orderId) {
      const o = order(orderId);
      return { orderId: o.id, status: o.status, payerEmail: o.payerEmail };
    },

    async authorizeOrder(orderId) {
      const o = order(orderId);
      if (o.intent !== "AUTHORIZE") unprocessable("ACTION_DOES_NOT_MATCH_INTENT", "This order was created with intent CAPTURE.");
      if (o.status === "COMPLETED") unprocessable("ORDER_ALREADY_AUTHORIZED", "This order has already been authorized.");
      if (o.status !== "APPROVED") unprocessable("ORDER_NOT_APPROVED", "The payer has not approved this order.");
      const id = paypalId();
      const expiresAt = addDays(now(), 29).toISOString();
      auths.set(id, { id, orderId, amount: { ...o.amount }, capturedCents: 0, status: "CREATED", expiresAt });
      o.status = "COMPLETED";
      o.authorizationId = id;
      return { authorizationId: id, status: "CREATED", expiresAt };
    },

    async captureOrder(orderId) {
      const o = order(orderId);
      if (o.intent !== "CAPTURE") unprocessable("ACTION_DOES_NOT_MATCH_INTENT", "This order was created with intent AUTHORIZE.");
      if (o.status === "COMPLETED") unprocessable("ORDER_ALREADY_CAPTURED", "This order has already been captured.");
      if (o.status !== "APPROVED") unprocessable("ORDER_NOT_APPROVED", "The payer has not approved this order.");
      const id = paypalId();
      captures.set(id, { id, authorizationId: null, orderId, amount: { ...o.amount }, refundedCents: 0, status: "COMPLETED", invoiceId: null });
      o.status = "COMPLETED";
      o.captureId = id;
      record(toCents(o.amount), o.amount.currency, o.payerEmail ?? "PayPal buyer", o.description);
      return { captureId: id, status: "COMPLETED", amount: { ...o.amount } };
    },

    async captureAuthorization(authorizationId, input) {
      const a = auth(authorizationId);
      assertPositive(input.amount);
      if (input.amount.currency !== a.amount.currency) unprocessable("CURRENCY_MISMATCH", "Capture currency must match the authorization.");
      if (a.status === "VOIDED") unprocessable("AUTHORIZATION_VOIDED", "A voided authorization cannot be captured.");
      if (a.status === "CAPTURED") unprocessable("AUTHORIZATION_ALREADY_CAPTURED", "This authorization has already been fully or finally captured.");
      if (Date.parse(a.expiresAt) < now().getTime()) unprocessable("AUTHORIZATION_EXPIRED", "The authorization has expired.");
      const remaining = toCents(a.amount) - a.capturedCents;
      const want = toCents(input.amount);
      if (want > remaining) {
        unprocessable(
          "MAX_CAPTURE_AMOUNT_EXCEEDED",
          `Capture of ${input.amount.value} exceeds the ${fromCents(remaining, a.amount.currency).value} left on the authorization.`,
        );
      }
      if (input.invoiceId) {
        if (invoiceIdsUsed.has(input.invoiceId)) unprocessable("DUPLICATE_INVOICE_ID", "Invoice ID was previously used.");
        invoiceIdsUsed.add(input.invoiceId);
      }
      a.capturedCents += want;
      a.status = input.finalCapture || a.capturedCents >= toCents(a.amount) ? "CAPTURED" : "PARTIALLY_CAPTURED";
      const id = paypalId();
      captures.set(id, {
        id,
        authorizationId,
        orderId: a.orderId,
        amount: { ...input.amount },
        refundedCents: 0,
        status: "COMPLETED",
        invoiceId: input.invoiceId ?? null,
      });
      const o = orders.get(a.orderId);
      record(want, input.amount.currency, o?.payerEmail ?? "PayPal buyer", input.noteToPayer ?? o?.description ?? null);
      return { captureId: id, status: "COMPLETED" };
    },

    async voidAuthorization(authorizationId) {
      const a = auth(authorizationId);
      if (a.status === "VOIDED") unprocessable("PREVIOUSLY_VOIDED", "This authorization has already been voided.");
      if (a.status === "CAPTURED") unprocessable("PREVIOUSLY_CAPTURED", "A fully or finally captured authorization cannot be voided.");
      a.status = "VOIDED";
      return { status: "VOIDED" };
    },

    async reauthorize(authorizationId, amount) {
      const a = auth(authorizationId);
      if (a.status === "VOIDED") unprocessable("AUTHORIZATION_VOIDED", "A voided authorization cannot be reauthorized.");
      if (a.status === "CAPTURED") unprocessable("AUTHORIZATION_ALREADY_CAPTURED", "This authorization has already been captured.");
      const value = amount ?? fromCents(toCents(a.amount) - a.capturedCents, a.amount.currency);
      assertPositive(value);
      const id = paypalId();
      auths.set(id, {
        id,
        orderId: a.orderId,
        amount: { ...value },
        capturedCents: 0,
        status: "CREATED",
        expiresAt: addDays(now(), 29).toISOString(),
      });
      return { authorizationId: id, status: "CREATED" };
    },

    async refundCapture(captureId, input) {
      const c = capture(captureId);
      if (c.status === "REFUNDED") unprocessable("CAPTURE_FULLY_REFUNDED", "The capture has already been fully refunded.");
      const remaining = toCents(c.amount) - c.refundedCents;
      const want = input.amount ? toCents(input.amount) : remaining;
      if (input.amount) {
        assertPositive(input.amount);
        if (input.amount.currency !== c.amount.currency) unprocessable("CURRENCY_MISMATCH", "Refund currency must match the capture.");
      }
      if (want > remaining) {
        unprocessable(
          "REFUND_AMOUNT_EXCEEDED",
          `Refund of ${fromCents(want, c.amount.currency).value} exceeds the ${fromCents(remaining, c.amount.currency).value} left on the capture.`,
        );
      }
      c.refundedCents += want;
      c.status = c.refundedCents >= toCents(c.amount) ? "REFUNDED" : "PARTIALLY_REFUNDED";
      const id = paypalId();
      refunds.set(id, { id, captureId, amount: fromCents(want, c.amount.currency) });
      const o = orders.get(c.orderId);
      record(-want, c.amount.currency, o?.payerEmail ?? "PayPal buyer", input.note ?? "Refund");
      return { refundId: id, status: "COMPLETED" };
    },

    async createPayout(input) {
      if (senderBatchIds.has(input.senderBatchId)) {
        fail(400, "USER_BUSINESS_ERROR", "User business error.", "DUPLICATE_REQUEST_ID", "Batch with given sender_batch_id already exists.");
      }
      if (input.items.length === 0) {
        fail(400, "VALIDATION_ERROR", "Invalid request - see details.", "ITEMS_REQUIRED", "A payout needs at least one item.");
      }
      for (const it of input.items) assertPositive(it.amount);
      senderBatchIds.add(input.senderBatchId);
      const payoutBatchId = paypalId(13);
      const items = input.items.map((it) => ({
        senderItemId: it.senderItemId,
        receiverEmail: it.receiverEmail,
        amount: { ...it.amount },
        note: it.note,
        status: "SUCCESS",
        transactionId: paypalId(),
      }));
      payouts.set(payoutBatchId, { payoutBatchId, senderBatchId: input.senderBatchId, status: "SUCCESS", items });
      for (const it of items) record(-toCents(it.amount), it.amount.currency, it.receiverEmail, it.note);
      return { payoutBatchId, status: "SUCCESS" };
    },

    async getPayout(payoutBatchId) {
      const p = payouts.get(payoutBatchId) ?? notFound("Payout batch", payoutBatchId);
      return {
        payoutBatchId: p.payoutBatchId,
        status: p.status,
        items: p.items.map((i) => ({ senderItemId: i.senderItemId, status: i.status, transactionId: i.transactionId })),
      };
    },

    async addTracking(input) {
      const o = order(input.orderId);
      const c = capture(input.captureId);
      if (c.orderId !== o.id) unprocessable("CAPTURE_ID_NOT_FOUND", "The capture does not belong to this order.");
      const list = tracking.get(c.id) ?? [];
      list.push({ trackingNumber: input.trackingNumber, carrier: input.carrier, notifyPayer: input.notifyPayer ?? false });
      tracking.set(c.id, list);
      return { status: "SHIPPED" };
    },

    async listTransactions(input) {
      const start = Date.parse(input.startDate);
      const end = Date.parse(input.endDate);
      return [...seededTransactions, ...liveTransactions]
        .filter((t) => {
          const at = Date.parse(t.date);
          return (Number.isNaN(start) || at >= start) && (Number.isNaN(end) || at <= end);
        })
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((t) => ({ ...t, amount: { ...t.amount } }));
    },

    async listInvoices() {
      return invoices.map((i) => ({ ...i, amount: { ...i.amount } }));
    },

    async sendInvoiceReminder(invoiceId) {
      const inv = invoices.find((i) => i.id === invoiceId) ?? notFound("Invoice", invoiceId);
      if (inv.status === "PAID" || inv.status === "CANCELLED") {
        unprocessable("INVALID_INVOICE_STATUS", `A ${inv.status} invoice cannot be reminded.`);
      }
      return { status: "SENT" };
    },

    async listDisputes() {
      return disputes.map((d) => ({ ...d, amount: { ...d.amount }, messages: [...d.messages] }));
    },

    async getDispute(disputeId) {
      const d = dispute(disputeId);
      return { ...d, amount: { ...d.amount }, messages: [...d.messages] };
    },

    async provideEvidence(disputeId, input) {
      const d = dispute(disputeId);
      if (d.status === "RESOLVED") unprocessable("DISPUTE_RESOLVED", "This dispute is already resolved.");
      d.status = "UNDER_REVIEW";
      const files = input.documents?.length ? ` (${input.documents.length} file(s))` : "";
      d.messages.push(`Seller evidence [${input.evidenceType ?? "OTHER"}]: ${input.notes}${files}`);
      return { status: d.status };
    },

    async acceptClaim(disputeId, note) {
      const d = dispute(disputeId);
      if (d.status === "RESOLVED") unprocessable("DISPUTE_RESOLVED", "This dispute is already resolved.");
      d.status = "RESOLVED";
      d.messages.push(`Seller accepted the claim: ${note}`);
      return { status: d.status };
    },

    async verifyWebhook() {
      return true;
    },

    /* ------------------------------------------------ mock-only controls */

    approveOrder(orderId, payerEmail) {
      const o = order(orderId);
      if (o.status !== "CREATED") unprocessable("ORDER_NOT_APPROVABLE", `Order is ${o.status}; only CREATED orders can be approved.`);
      o.status = "APPROVED";
      o.payerEmail = payerEmail;
    },
    cancelOrder(orderId) {
      const o = order(orderId);
      if (o.status === "COMPLETED") unprocessable("ORDER_ALREADY_COMPLETED", "A completed order cannot be cancelled.");
      o.status = "VOIDED";
    },
    seedTransactions(txns) {
      seededTransactions = upsertById(seededTransactions, txns.map((t) => ({ ...t, amount: { ...t.amount } })));
    },
    seedInvoices(list) {
      invoices = upsertById(invoices, list.map((i) => ({ ...i, amount: { ...i.amount } })));
    },
    seedDisputes(list) {
      disputes = upsertById(disputes, list.map((d) => ({ ...d, amount: { ...d.amount }, messages: [...d.messages] })));
    },
    calls() {
      return callLog.map((c) => ({ ...c, args: [...c.args] }));
    },

    inspectOrder(orderId) {
      const o = orders.get(orderId);
      return o ? { ...o, amount: { ...o.amount } } : null;
    },
    inspectAuthorization(authorizationId) {
      const a = auths.get(authorizationId);
      return a ? { ...a, amount: { ...a.amount } } : null;
    },
    inspectCapture(captureId) {
      const c = captures.get(captureId);
      return c ? { ...c, amount: { ...c.amount } } : null;
    },
    inspectPayout(payoutBatchId) {
      const p = payouts.get(payoutBatchId);
      return p ? { ...p, items: p.items.map((i) => ({ ...i })) } : null;
    },
    inspectTracking(captureId) {
      return [...(tracking.get(captureId) ?? [])];
    },
    disputeIds() {
      return disputes.map((d) => d.id);
    },
  };

  // Record every PayPalRail call (including ones that throw) for tests and the demo console.
  const target = rail as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  for (const name of RAIL_METHODS) {
    const original = target[name].bind(rail);
    target[name] = (...args: unknown[]) => {
      callLog.push({ method: name, args: JSON.parse(JSON.stringify(args ?? [])) as unknown[], at: now().toISOString() });
      return original(...args);
    };
  }

  // Shared state. Every rail method body is synchronous (no await), so for an `async` method the whole
  // body has run by the time the call returns its promise. Load before, save in `finally` after, in
  // the same tick: nothing in this process can interleave. Keep it that way: never add an await
  // inside a rail method body.
  const shared = opts.store?.collection<MockRailState>("core", "mock-rail");
  if (shared) {
    const snapshot = (): MockRailState => ({
      version: 1,
      orders: [...orders.values()],
      auths: [...auths.values()],
      captures: [...captures.values()],
      refunds: [...refunds.values()],
      payouts: [...payouts.values()],
      senderBatchIds: [...senderBatchIds],
      invoiceIdsUsed: [...invoiceIdsUsed],
      tracking: [...tracking.entries()],
      seededTransactions,
      liveTransactions,
      invoices,
      disputes,
      callLog: callLog.slice(-MOCK_RAIL_CALL_LOG_LIMIT),
    });
    const hydrate = (raw: MockRailState): void => {
      const d = structuredClone(raw);
      const fill = <K, V>(m: Map<K, V>, entries: [K, V][]) => {
        m.clear();
        for (const [k, v] of entries) m.set(k, v);
      };
      fill(orders, d.orders.map((o) => [o.id, o]));
      fill(auths, d.auths.map((a) => [a.id, a]));
      fill(captures, d.captures.map((c) => [c.id, c]));
      fill(refunds, d.refunds.map((r) => [r.id, r]));
      fill(payouts, d.payouts.map((p) => [p.payoutBatchId, p]));
      fill(tracking, d.tracking);
      senderBatchIds.clear();
      for (const x of d.senderBatchIds) senderBatchIds.add(x);
      invoiceIdsUsed.clear();
      for (const x of d.invoiceIdsUsed) invoiceIdsUsed.add(x);
      seededTransactions = d.seededTransactions;
      liveTransactions = d.liveTransactions;
      invoices = d.invoices;
      disputes = d.disputes;
      callLog = d.callLog;
    };
    const load = (): void => {
      const raw = shared.get(MOCK_RAIL_STATE_KEY);
      if (raw) hydrate(raw);
    };
    const save = (): void => {
      shared.put(MOCK_RAIL_STATE_KEY, snapshot());
    };
    const sandwich = <A extends unknown[], R>(fn: (...args: A) => R) =>
      (...args: A): R => {
        load();
        try {
          return fn(...args);
        } finally {
          save();
        }
      };
    const wrapped = rail as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(wrapped)) {
      if (typeof value === "function") wrapped[key] = sandwich(value as (...args: unknown[]) => unknown);
    }
    // First instance seeds; later ones keep whatever is already persisted.
    if (!shared.get(MOCK_RAIL_STATE_KEY)) save();
  }
  return rail;
}
