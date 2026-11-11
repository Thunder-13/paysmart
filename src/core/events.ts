/**
 * Data shapes for core ledger events, plus a typed append helper.
 * Raw PayPalRail methods never write ledger events; CoreServices does, and pipelines that call
 * ctx.rail directly (e.g. addTracking) append their own events with these shapes.
 */
import type {
  Actor,
  Clause,
  EvidenceRef,
  Ledger,
  LedgerEvent,
  Money,
  Principal,
  Proposal,
  RunStatus,
  RunWait,
  SlipStatus,
  Verdict,
} from "./contracts";

export interface SlipCreatedData {
  intent: string;
  principal: Principal;
  clauses: Clause[];
  budget: Money;
  expiresAt: string;
  parentId: string | null;
}
export interface SlipSigningStartedData {
  orderId: string;
  intent: "AUTHORIZE" | "CAPTURE";
  approveUrl: string;
}
export interface SlipSignedData {
  orderId: string;
  authorizationId: string | null;
  captureId: string | null;
}
export interface SlipStatusData {
  from: SlipStatus;
  to: SlipStatus;
  reason: string;
}
export interface ChildCreatedData {
  parentId: string;
  childId: string;
  budget: Money;
  intent: string;
}
export interface GuardVerdictData {
  proposal: Proposal;
  verdict: Verdict;
}
export interface RailOrderCreatedData {
  orderId: string;
  intent: "AUTHORIZE" | "CAPTURE";
  amount: Money;
  approveUrl: string;
  status: string;
}
export interface RailAuthorizedData {
  authorizationId: string;
  amount: Money;
  expiresAt: string | null;
}
export interface RailCapturedData {
  captureId: string;
  amount: Money;
  finalCapture: boolean;
  /** Proposal that the capture settles (absent for CAPTURE-intent signing). */
  proposalId?: string;
  /** Child slip spend folded into this capture. */
  children?: { slipId: string; amount: Money }[];
}
export interface RailVoidedData {
  authorizationId: string;
}
export interface RailReauthorizedData {
  authorizationId: string;
  previousAuthorizationId: string;
  amount: Money | null;
}
export interface RailRefundedData {
  refundId: string;
  captureId: string;
  amount: Money;
  reason: string;
}
export interface RailPayoutCreatedData {
  payoutBatchId: string;
  status?: string;
  proposalId?: string;
  items: { receiverEmail: string; amount: Money; note: string; senderItemId: string }[];
}
export interface RailTrackingAddedData {
  captureId: string;
  trackingNumber: string;
  carrier: string;
}
export interface RailInvoiceReminderData {
  invoiceId: string;
  subject: string;
}
export interface RailDisputeEvidenceData {
  disputeId: string;
  status: string;
  documents: string[];
}
export interface RailDisputeAcceptedData {
  disputeId: string;
  status: string;
  note: string;
}
export type EvidenceAddedData = EvidenceRef;
export interface AgentStepData {
  label?: string;
  step: unknown;
}
export interface RunStepData {
  runId: string;
  step: string;
  next: string | null;
}
export interface RunWaitingData {
  runId: string;
  step: string;
  wait: RunWait;
}
export interface RunDoneData {
  runId: string;
  step: string;
  status: Extract<RunStatus, "done">;
}
export interface RunFailedData {
  runId: string;
  step: string;
  error: string;
}
export interface WebhookReceivedData {
  eventId: string | null;
  eventType: string;
  resourceType: string | null;
  resourceId: string | null;
  summary: string | null;
}
export interface NoteData {
  message: string;
  runId?: string;
  step?: string;
  data?: unknown;
}

/** Event type -> data shape for every core event. */
export interface CoreEventData {
  "slip.created": SlipCreatedData;
  "slip.compiled": unknown;
  "slip.signing_started": SlipSigningStartedData;
  "slip.signed": SlipSignedData;
  "slip.status": SlipStatusData;
  "child.created": ChildCreatedData;
  "guard.verdict": GuardVerdictData;
  "rail.order_created": RailOrderCreatedData;
  "rail.authorized": RailAuthorizedData;
  "rail.captured": RailCapturedData;
  "rail.voided": RailVoidedData;
  "rail.reauthorized": RailReauthorizedData;
  "rail.refunded": RailRefundedData;
  "rail.payout_created": RailPayoutCreatedData;
  "rail.tracking_added": RailTrackingAddedData;
  "rail.invoice_reminder": RailInvoiceReminderData;
  "rail.dispute_evidence": RailDisputeEvidenceData;
  "rail.dispute_accepted": RailDisputeAcceptedData;
  "evidence.added": EvidenceAddedData;
  "agent.step": AgentStepData;
  "run.step": RunStepData;
  "run.waiting": RunWaitingData;
  "run.done": RunDoneData;
  "run.failed": RunFailedData;
  "webhook.received": WebhookReceivedData;
  note: NoteData;
}

/** Typed append for core events: the compiler checks the data shape. */
export function appendEvent<K extends keyof CoreEventData>(
  ledger: Ledger,
  slipId: string,
  type: K,
  actor: Actor,
  data: CoreEventData[K],
): LedgerEvent {
  return ledger.append(slipId, type, actor, data);
}

/**
 * The one way to record a guard decision. CoreServices.evaluate uses it, and pipelines that call
 * the pure guard directly should too, so every "guard.verdict" event has the same shape.
 */
export function appendVerdictEvent(ledger: Ledger, slipId: string, proposal: Proposal, verdict: Verdict): LedgerEvent {
  return appendEvent(ledger, slipId, "guard.verdict", "guard", { proposal, verdict });
}

/** Typed read of an event's data, e.g. eventData(e, "guard.verdict").verdict. Throws on a type mismatch. */
export function eventData<K extends keyof CoreEventData>(event: LedgerEvent, type: K): CoreEventData[K] {
  if (event.type !== type) throw new Error(`Expected a ${type} event, got ${event.type}`);
  return event.data as CoreEventData[K];
}
