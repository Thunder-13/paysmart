/**
 * FROZEN SHARED CONTRACT (Stage 0, written by the orchestrator).
 *
 * Every pipeline and the core runtime build against these types. Do not edit
 * this file from a worker. If a change is unavoidable, report it to the
 * orchestrator: additive changes only, never renames or removals.
 *
 * Mental model: every dollar an AI touches carries a Slip (a signed mandate).
 * A Proposal is anything an agent wants to do with money under a Slip.
 * The Guard compares Proposal facts with Slip clauses, deterministically.
 * The Rail moves money on PayPal. The Ledger records everything, hash-chained.
 * The Orchestrator runs each pipeline as named steps that can wait on humans.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ ids */

export const PIPELINE_IDS = [
  "shop", // 1 Permission Slip shopping (+4 voice add-on, +6 hire-a-helper child slips)
  "second-look", // 2 scam interceptor, protected payment to a stranger
  "bounty", // 3 bounty board, photo-verified payouts
  "cash-weather", // 5+9 cash-flow forecast, invoice nudges, upstream patronage payouts
  "toll-road", // 7 HTTP 402 metered access for AI agents, settled on PayPal
  "dispute-desk", // 8 merchant dispute copilot fed by slip evidence
  "paysmart", // front door: plain-words ask, agent shops, other pipelines screen, PayPal pays
] as const;
export const PipelineIdSchema = z.enum(PIPELINE_IDS);
export type PipelineId = z.infer<typeof PipelineIdSchema>;

/* ---------------------------------------------------------------- money */

/** PayPal wire format: decimal string with exactly 2 places, ISO currency. */
export const MoneySchema = z.object({
  currency: z.string().length(3),
  value: z.string().regex(/^-?\d+\.\d{2}$/),
});
export type Money = z.infer<typeof MoneySchema>;

/* -------------------------------------------------------------- clauses */

const clauseBase = {
  /** Stable, human-citable id: "c1", "c2", ... */
  id: z.string(),
  /** Plain-words line shown on the slip card, e.g. "Nothing that needs batteries". */
  label: z.string(),
};

export const FactValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type FactValue = z.infer<typeof FactValueSchema>;

export const EvidenceKindSchema = z.enum([
  "delivery_photo",
  "before_after_photos",
  "tracking",
  "work_product",
]);
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

export const ClauseSchema = z.discriminatedUnion("kind", [
  z.object({ ...clauseBase, kind: z.literal("budget_max"), amount: MoneySchema }),
  z.object({ ...clauseBase, kind: z.literal("quantity_max"), count: z.number().int().positive() }),
  z.object({ ...clauseBase, kind: z.literal("category_in"), categories: z.array(z.string()).min(1) }),
  /** ISO date (YYYY-MM-DD). Proposal items must have deliveryEstimate <= date. */
  z.object({ ...clauseBase, kind: z.literal("deliver_by"), date: z.string() }),
  /** Reject items whose facts.attributes[attribute] is one of values. */
  z.object({
    ...clauseBase,
    kind: z.literal("exclude_attribute"),
    attribute: z.string(),
    values: z.array(FactValueSchema).min(1),
  }),
  /** Payee email or merchant id must be in the list. */
  z.object({ ...clauseBase, kind: z.literal("payee_allowlist"), payees: z.array(z.string()).min(1) }),
  /** Proposal must carry an EvidenceRef of this kind with verdict "pass". */
  z.object({ ...clauseBase, kind: z.literal("require_evidence"), evidence: EvidenceKindSchema, rubric: z.string() }),
  /** Metered price cap: each item's unitPrice must be <= price (toll-road fetches, helper tasks). */
  z.object({ ...clauseBase, kind: z.literal("rate_card"), unit: z.enum(["fetch", "task"]), price: MoneySchema }),
  /** Payout split; weights in basis points, must sum to 10000. */
  z.object({
    ...clauseBase,
    kind: z.literal("split_rule"),
    splits: z.array(z.object({ payee: z.string(), weightBps: z.number().int().min(0).max(10000) })).min(1),
  }),
  /** ISO datetime after which nothing may settle. */
  z.object({ ...clauseBase, kind: z.literal("expires_at"), at: z.string() }),
]);
export type Clause = z.infer<typeof ClauseSchema>;
export type ClauseKind = Clause["kind"];

/* ----------------------------------------------------------------- slip */

export const SlipStatusSchema = z.enum([
  "draft", // compiled, not signed
  "awaiting_signature", // PayPal order created, waiting for buyer approval
  "active", // signed: authorization held (or order captured for CAPTURE-intent slips)
  "settling", // money is moving
  "settled", // final capture or payout done
  "released", // unspent authorization voided
  "refunded",
  "disputed",
  "expired",
  "rejected", // user declined or PayPal approval cancelled
]);
export type SlipStatus = z.infer<typeof SlipStatusSchema>;

export const SlipRailSchema = z.object({
  orderId: z.string().nullable(),
  authorizationId: z.string().nullable(),
  approveUrl: z.string().nullable(),
  captureIds: z.array(z.string()),
  refundIds: z.array(z.string()),
  payoutBatchIds: z.array(z.string()),
});
export type SlipRail = z.infer<typeof SlipRailSchema>;

export const PrincipalSchema = z.object({ name: z.string(), email: z.string().nullable() });
export type Principal = z.infer<typeof PrincipalSchema>;

export const SlipSchema = z.object({
  id: z.string(),
  pipeline: PipelineIdSchema,
  /** Set on child slips (Hire Wire helpers). Child budgets are carved out of the parent. */
  parentId: z.string().nullable(),
  principal: PrincipalSchema,
  /** The user's original words, verbatim. */
  intent: z.string(),
  clauses: z.array(ClauseSchema),
  budget: MoneySchema,
  spent: MoneySchema,
  status: SlipStatusSchema,
  rail: SlipRailSchema,
  createdAt: z.string(),
  expiresAt: z.string(),
  meta: z.record(z.string(), z.unknown()),
});
export type Slip = z.infer<typeof SlipSchema>;

export type NewSlip = Pick<Slip, "pipeline" | "principal" | "intent" | "clauses" | "budget" | "expiresAt"> & {
  parentId?: string | null;
  meta?: Record<string, unknown>;
};

/** Output of the mandate compiler (plain words in, clauses out). */
export const CompiledSlipSchema = z.object({
  clauses: z.array(ClauseSchema).min(1),
  budget: MoneySchema,
  expiresAt: z.string(),
  /** One-sentence plain-words restatement shown above the clauses. */
  summary: z.string(),
});
export type CompiledSlip = z.infer<typeof CompiledSlipSchema>;

/* ------------------------------------------------- facts and proposals */

/**
 * Facts pulled from UNTRUSTED text by the quarantined extractor. The guard
 * only ever sees these fields, never the raw listing or page text.
 */
export const ExtractedFactsSchema = z.object({
  category: z.string().nullable(),
  inStock: z.boolean().nullable(),
  /** ISO date or null when unknown. */
  deliveryEstimate: z.string().nullable(),
  /** Units inside one listing (a 4-pack is 4). */
  itemCount: z.number().int().nullable(),
  /** Normalized attributes, e.g. { power_source: "battery", age_min: 3 }. */
  attributes: z.record(z.string(), FactValueSchema),
  /** True when the text tries to instruct an AI (prompt injection marker). */
  injectionSuspected: z.boolean(),
});
export type ExtractedFacts = z.infer<typeof ExtractedFactsSchema>;

export const EvidenceRefSchema = z.object({
  kind: EvidenceKindSchema,
  verdict: z.enum(["pass", "fail", "unknown"]),
  detail: z.string(),
  /** Blob ref, tracking number, or other pointer. */
  ref: z.string().nullable(),
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

export const ProposalItemSchema = z.object({
  title: z.string(),
  quantity: z.number().int().positive(),
  unitPrice: MoneySchema,
  facts: ExtractedFactsSchema,
  sourceUrl: z.string().nullable(),
});
export type ProposalItem = z.infer<typeof ProposalItemSchema>;

export const PayeeSchema = z.object({
  email: z.string().nullable(),
  merchantId: z.string().nullable(),
  name: z.string().nullable(),
});
export type Payee = z.infer<typeof PayeeSchema>;

export const ProposalKindSchema = z.enum([
  "purchase", // capture against the slip's authorization
  "payment", // CAPTURE-intent payment to a third party (second-look)
  "payout", // PayPal Payouts to one or more receivers
  "metered_charge", // one metered unit (toll-road fetch), settled later in bulk
  "child_slip", // carve a helper budget out of the parent slip
  "refund",
]);
export type ProposalKind = z.infer<typeof ProposalKindSchema>;

export const ProposalSchema = z.object({
  id: z.string(),
  slipId: z.string(),
  kind: ProposalKindSchema,
  amount: MoneySchema,
  payee: PayeeSchema.nullable(),
  items: z.array(ProposalItemSchema),
  evidence: z.array(EvidenceRefSchema),
  /** Agent's own explanation. Untrusted; displayed, never evaluated. */
  rationale: z.string(),
  createdAt: z.string(),
});
export type Proposal = z.infer<typeof ProposalSchema>;
export type NewProposal = Omit<Proposal, "id" | "createdAt">;

/* -------------------------------------------------------------- verdict */

/** Synthetic clause id used when an item's facts flag prompt injection. */
export const INTEGRITY_CLAUSE_ID = "integrity";

export const VerdictSchema = z.object({
  /** outside: any violation. ask: no violation but unknown facts. within: clean. */
  decision: z.enum(["within", "outside", "ask"]),
  violations: z.array(z.object({ clauseId: z.string(), message: z.string() })),
  unknowns: z.array(z.object({ clauseId: z.string(), field: z.string(), message: z.string() })),
  checkedAt: z.string(),
});
export type Verdict = z.infer<typeof VerdictSchema>;

/** Pure and deterministic. No I/O, no LLM. */
export type GuardFn = (slip: Slip, proposal: Proposal, ctx: { spent: Money; now: Date }) => Verdict;

/* --------------------------------------------------------------- ledger */

export const ActorSchema = z.enum(["user", "agent", "guard", "rail", "webhook", "system"]);
export type Actor = z.infer<typeof ActorSchema>;

export type CoreEventType =
  | "slip.created"
  | "slip.compiled"
  | "slip.signing_started"
  | "slip.signed"
  | "slip.status"
  | "child.created"
  | "guard.verdict"
  | "rail.order_created"
  | "rail.authorized"
  | "rail.captured"
  | "rail.voided"
  | "rail.reauthorized"
  | "rail.refunded"
  | "rail.payout_created"
  | "rail.tracking_added"
  | "rail.invoice_reminder"
  | "rail.dispute_evidence"
  | "rail.dispute_accepted"
  | "evidence.added"
  | "agent.step"
  | "run.step"
  | "run.waiting"
  | "run.done"
  | "run.failed"
  | "webhook.received"
  | "affiliate.attributed"
  | "affiliate.reversed"
  | "note";
/** Pipelines may add their own namespaced events, e.g. "bounty.claimed". */
export type LedgerEventType = CoreEventType | `${PipelineId}.${string}`;

export const LedgerEventSchema = z.object({
  seq: z.number().int(),
  slipId: z.string(),
  type: z.string(),
  actor: ActorSchema,
  at: z.string(),
  data: z.unknown(),
  /** sha256 of the previous event in this slip's chain ("GENESIS" for seq 1). */
  prevHash: z.string(),
  /** sha256(prevHash + canonical JSON of {seq, slipId, type, actor, at, data}). */
  hash: z.string(),
});
export type LedgerEvent = z.infer<typeof LedgerEventSchema>;

export interface Ledger {
  append(slipId: string, type: LedgerEventType, actor: Actor, data: unknown): LedgerEvent;
  list(slipId: string): LedgerEvent[];
  listRecent(limit: number): LedgerEvent[];
  verifyChain(slipId: string): { ok: boolean; brokenAtSeq: number | null };
  /** Live feed for SSE. Returns an unsubscribe function. */
  subscribe(listener: (event: LedgerEvent) => void): () => void;
}

/* ---------------------------------------------------------------- store */

export interface SlipStore {
  create(input: NewSlip): Slip;
  get(id: string): Slip | null;
  update(id: string, patch: Partial<Omit<Slip, "id" | "pipeline" | "createdAt">>): Slip;
  list(filter?: { pipeline?: PipelineId; parentId?: string; status?: SlipStatus }): Slip[];
  /** Find the slip that owns a PayPal order, authorization, capture, refund or payout id. */
  findByRailId(railId: string): Slip | null;
}

/** Schemaless JSON document collection for pipeline-owned records. */
export interface Collection<T> {
  put(id: string, doc: T): T;
  get(id: string): T | null;
  list(): T[];
  remove(id: string): void;
}

export interface BlobStore {
  put(input: { contentType: string; base64: string }): string; // returns ref
  get(ref: string): { contentType: string; base64: string } | null;
}

export interface Store {
  slips: SlipStore;
  ledger: Ledger;
  blobs: BlobStore;
  collection<T>(owner: PipelineId | "core", name: string): Collection<T>;
}

/* ---------------------------------------------------------- PayPal rail */

export interface RailTransaction {
  id: string;
  date: string; // ISO
  /** Signed: positive is money in, negative is money out. */
  amount: Money;
  counterparty: string;
  note: string | null;
}

export interface RailInvoice {
  id: string;
  number: string;
  status: string; // PayPal invoice status, e.g. SENT, PAID, UNPAID, PARTIALLY_PAID
  recipientEmail: string;
  recipientName: string | null;
  amount: Money;
  dueDate: string | null; // ISO date
  issuedAt: string; // ISO date
}

export interface RailDispute {
  id: string;
  reason: string; // e.g. MERCHANDISE_OR_SERVICE_NOT_RECEIVED
  status: string; // e.g. WAITING_FOR_SELLER_RESPONSE
  amount: Money;
  createdAt: string;
  sellerResponseDueAt: string | null;
  /** Capture/transaction id the dispute is about (links back to a slip). */
  transactionId: string | null;
  buyerEmail: string | null;
  messages: string[];
}

export interface PayPalRail {
  readonly mode: "sandbox" | "mock";
  createOrder(input: {
    intent: "AUTHORIZE" | "CAPTURE";
    amount: Money;
    payee?: { email?: string; merchantId?: string };
    description: string;
    customId: string;
    returnUrl: string;
    cancelUrl: string;
  }): Promise<{ orderId: string; approveUrl: string; status: string }>;
  getOrder(orderId: string): Promise<{ orderId: string; status: string; payerEmail: string | null }>;
  authorizeOrder(orderId: string): Promise<{ authorizationId: string; status: string; expiresAt: string | null }>;
  captureOrder(orderId: string): Promise<{ captureId: string; status: string; amount: Money }>;
  captureAuthorization(
    authorizationId: string,
    input: { amount: Money; finalCapture: boolean; invoiceId?: string; noteToPayer?: string },
  ): Promise<{ captureId: string; status: string }>;
  voidAuthorization(authorizationId: string): Promise<{ status: string }>;
  reauthorize(authorizationId: string, amount?: Money): Promise<{ authorizationId: string; status: string }>;
  refundCapture(captureId: string, input: { amount?: Money; note?: string }): Promise<{ refundId: string; status: string }>;
  createPayout(input: {
    senderBatchId: string;
    emailSubject: string;
    items: { receiverEmail: string; amount: Money; note: string; senderItemId: string }[];
  }): Promise<{ payoutBatchId: string; status: string }>;
  getPayout(payoutBatchId: string): Promise<{
    payoutBatchId: string;
    status: string;
    items: { senderItemId: string; status: string; transactionId: string | null }[];
  }>;
  addTracking(input: {
    orderId: string;
    captureId: string;
    trackingNumber: string;
    carrier: string;
    notifyPayer?: boolean;
  }): Promise<{ status: string }>;
  listTransactions(input: { startDate: string; endDate: string }): Promise<RailTransaction[]>;
  listInvoices(): Promise<RailInvoice[]>;
  sendInvoiceReminder(invoiceId: string, input: { subject: string; note: string }): Promise<{ status: string }>;
  listDisputes(): Promise<RailDispute[]>;
  getDispute(disputeId: string): Promise<RailDispute>;
  provideEvidence(
    disputeId: string,
    input: {
      notes: string;
      documents?: { name: string; contentType: string; base64: string }[];
      /** PayPal evidence_type, e.g. PROOF_OF_FULFILLMENT, PROOF_OF_REFUND, OTHER. Defaults to OTHER. */
      evidenceType?: string;
    },
  ): Promise<{ status: string }>;
  acceptClaim(disputeId: string, note: string): Promise<{ status: string }>;
  verifyWebhook(headers: Record<string, string>, rawBody: string): Promise<boolean>;
}

/** Extra controls that exist only on the mock rail (tests, demo seed, offline demo). */
export interface MockRailControls {
  approveOrder(orderId: string, payerEmail: string): void;
  cancelOrder(orderId: string): void;
  seedTransactions(txns: RailTransaction[]): void;
  seedInvoices(invoices: RailInvoice[]): void;
  seedDisputes(disputes: RailDispute[]): void;
  // ADDED BY CORE: log of every PayPalRail method call on the mock (tests assert e.g. zero calls per metered fetch).
  calls(): { method: string; args: unknown[]; at: string }[];
}

/* ------------------------------------------------------------------- AI */

export type ModelTier = "smart" | "fast";

export interface ImageInput {
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  base64: string;
}

export interface AgentTool<I = unknown> {
  name: string;
  description: string;
  input: z.ZodType<I>;
  run(input: I): Promise<unknown>;
}

export type AgentStep =
  | { index: number; kind: "tool_call"; name: string; input: unknown }
  | { index: number; kind: "tool_result"; name: string; output: unknown }
  | { index: number; kind: "message"; text: string };

export interface AgentResult {
  finalText: string;
  steps: AgentStep[];
}

/**
 * Mock mode replays this script through the REAL tools, so tool logic, the
 * guard and the rail still execute. Only the model's choices are scripted.
 */
export type MockAgentScript = Array<{ tool: string; input: unknown } | { say: string }>;

export interface AI {
  readonly mode: "anthropic" | "mock";
  /** Structured output validated by schema. `mock` is used in mock mode and as nothing else. */
  json<T>(req: {
    label: string;
    tier: ModelTier;
    system: string;
    prompt: string;
    schema: z.ZodType<T>;
    images?: ImageInput[];
    mock: () => T;
  }): Promise<T>;
  text(req: {
    label: string;
    tier: ModelTier;
    system: string;
    prompt: string;
    images?: ImageInput[];
    mock: () => string;
  }): Promise<string>;
  runAgent(req: {
    label: string;
    tier: ModelTier;
    system: string;
    task: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tools carry heterogeneous input types
    tools: AgentTool<any>[];
    maxSteps: number;
    mock: MockAgentScript;
    onStep?: (step: AgentStep) => void;
  }): Promise<AgentResult>;
}

/**
 * Quarantined extractor: reads untrusted text, returns facts only. It has no
 * tools and its output is schema-validated, so injected instructions can at
 * worst produce wrong facts, which the guard then checks against the slip.
 */
export interface Extractor {
  extract(
    untrusted: { title: string; text: string },
    opts: { attributes: string[]; mock: () => ExtractedFacts },
  ): Promise<ExtractedFacts>;
}

/* --------------------------------------------------------- core services */

export interface EvidencePack {
  slip: Slip;
  children: Slip[];
  events: LedgerEvent[];
  chain: { ok: boolean; brokenAtSeq: number | null };
  verdicts: Verdict[];
  evidence: EvidenceRef[];
  /** Plain-words narrative (AI-written, mock fallback). */
  summary: string;
  generatedAt: string;
}

export interface CoreServices {
  /** Plain words in, numbered clauses out. */
  compileSlip(input: {
    pipeline: PipelineId;
    intent: string;
    principal: Principal;
    /** Extra guidance for the compiler, e.g. which clause kinds this pipeline uses. */
    guidance?: string;
    mock: () => CompiledSlip;
  }): Promise<CompiledSlip>;
  createSlip(input: NewSlip): Slip;
  /** Creates the PayPal order and returns where the buyer approves it. */
  beginSigning(
    slipId: string,
    input: { intent: "AUTHORIZE" | "CAPTURE"; payee?: { email?: string; merchantId?: string }; returnPath: string },
  ): Promise<{ approveUrl: string; orderId: string }>;
  /** After approval: AUTHORIZE-intent slips get authorized, CAPTURE-intent slips get captured. */
  completeSigning(slipId: string): Promise<Slip>;
  /** Guard only. Records a guard.verdict event. */
  evaluate(slipId: string, proposal: NewProposal): Verdict;
  /** Guard, then capture against the authorization when within. */
  settlePurchase(
    slipId: string,
    proposal: NewProposal,
    opts: { finalCapture: boolean },
  ): Promise<{ verdict: Verdict; captureId: string | null }>;
  /** Guard, then PayPal Payouts when within. */
  settlePayout(
    slipId: string,
    proposal: NewProposal,
    items: { receiverEmail: string; amount: Money; note: string }[],
  ): Promise<{ verdict: Verdict; payoutBatchId: string | null }>;
  /** Voids whatever is left on the authorization. Safe to call twice. */
  releaseRemainder(slipId: string): Promise<void>;
  refund(slipId: string, input: { captureId: string; amount?: Money; reason: string }): Promise<{ refundId: string }>;
  /** Guarded against the parent's remaining budget. */
  createChildSlip(
    parentId: string,
    input: Pick<NewSlip, "intent" | "clauses" | "budget" | "principal" | "expiresAt"> & { meta?: Record<string, unknown> },
  ): { verdict: Verdict; child: Slip | null };
  addEvidence(slipId: string, evidence: EvidenceRef): void;
  evidencePack(slipId: string): Promise<EvidencePack>;
}

/* ---------------------------------------------------------- orchestrator */

export const RunStatusSchema = z.enum(["running", "waiting", "done", "failed"]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export type WaitKind = "paypal_approval" | "user_confirm" | "user_upload" | "external_event";

export interface RunWait {
  kind: WaitKind;
  message: string;
  data?: unknown;
}

export interface Run<S = Record<string, unknown>> {
  id: string;
  pipeline: PipelineId;
  slipId: string | null;
  status: RunStatus;
  step: string;
  state: S;
  wait: RunWait | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StepContext<S> {
  run: Run<S>;
  /** Payload passed to resume() for the step that follows a wait; undefined otherwise. */
  signal: unknown;
  rail: PayPalRail;
  ai: AI;
  extractor: Extractor;
  guard: GuardFn;
  store: Store;
  core: CoreServices;
  baseUrl: string;
  now(): Date;
  log(message: string, data?: unknown): void;
}

export type StepResult<S> =
  | { next: string; state?: Partial<S>; slipId?: string }
  | { done: true; state?: Partial<S>; slipId?: string }
  | { wait: RunWait; resumeAt: string; state?: Partial<S>; slipId?: string }
  | { fail: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- registry holds heterogeneous pipelines
export interface PipelineDefinition<I = any, S extends Record<string, unknown> = any> {
  id: PipelineId;
  title: string;
  tagline: string;
  /** PayPal and AI capabilities this pipeline exercises, shown as badges. */
  primitives: string[];
  input: z.ZodType<I>;
  initialState(input: I): S;
  firstStep: string;
  steps: Record<string, (ctx: StepContext<S>) => Promise<StepResult<S>>>;
}

export interface Orchestrator {
  start(pipeline: PipelineId, input: unknown): Promise<Run>;
  resume(runId: string, signal: unknown): Promise<Run>;
  get(runId: string): Run | null;
  list(filter?: { pipeline?: PipelineId; status?: RunStatus }): Run[];
}

/** Everything server code needs, built once from env (see src/server/runtime.ts). */
export interface Runtime {
  rail: PayPalRail;
  ai: AI;
  extractor: Extractor;
  guard: GuardFn;
  store: Store;
  core: CoreServices;
  orchestrator: Orchestrator;
  baseUrl: string;
  now(): Date;
}
