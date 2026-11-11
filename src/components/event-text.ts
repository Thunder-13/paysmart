/** Plain-words lines for ledger events, used by LedgerTimeline, EvidencePackView and the console. */
import type { Actor, LedgerEvent, Money, Verdict } from "@/core/contracts";
import { formatMoney } from "@/core/money";

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function isMoney(v: unknown): v is Money {
  const o = obj(v);
  return typeof o.value === "string" && typeof o.currency === "string";
}

function amt(v: unknown): string {
  return isMoney(v) ? formatMoney(v) : "";
}

const DECISION_WORDS: Record<Verdict["decision"], string> = {
  within: "within the slip",
  outside: "outside the slip",
  ask: "needs your call",
};

export const ACTOR_WORDS: Record<Actor, string> = {
  user: "You",
  agent: "Agent",
  guard: "Guard",
  rail: "PayPal",
  webhook: "PayPal webhook",
  system: "System",
};

/**
 * Title and detail for one event. When the event carries a plain-words `data.message` (pipelines
 * write one on most of their own events), that message is the title; otherwise the type decides.
 */
export function describeEvent(e: LedgerEvent): { title: string; detail: string | null } {
  const d = obj(e.data);
  const message = typeof d.message === "string" && d.message.trim() !== "" ? d.message.trim() : null;
  const base = describeByType(e, d);
  if (!message || message === base.title) return base;
  if (e.type.includes(".") && !CORE_PREFIXES.some((p) => e.type.startsWith(p))) {
    // A pipeline event: its message says it better than the humanized type name.
    const summary = typeof d.summary === "string" && d.summary.trim() !== "" && d.summary !== message ? d.summary : null;
    return { title: message, detail: summary };
  }
  // A core event that also carries a message: keep the core title, show the message as the detail.
  return { title: base.title, detail: base.detail && base.detail !== message ? `${message} · ${base.detail}` : message };
}

const CORE_PREFIXES = ["slip.", "child.", "guard.", "rail.", "evidence.", "agent.", "run.", "webhook."];

function describeByType(e: LedgerEvent, d: Record<string, unknown>): { title: string; detail: string | null } {
  switch (e.type) {
    case "slip.created": {
      const clauses = Array.isArray(d.clauses) ? d.clauses.length : 0;
      return { title: "Slip written", detail: `${clauses} clause${clauses === 1 ? "" : "s"}, budget ${amt(d.budget)}` };
    }
    case "slip.compiled":
      return { title: "Plain words compiled into clauses", detail: null };
    case "slip.signing_started":
      return { title: "Sent to PayPal for signature", detail: typeof d.orderId === "string" ? `Order ${d.orderId}` : null };
    case "slip.signed":
      return { title: "Signed with PayPal", detail: typeof d.orderId === "string" ? `Order ${d.orderId}` : null };
    case "slip.status":
      return { title: `Status: ${String(d.from ?? "?")} → ${String(d.to ?? "?")}`, detail: typeof d.reason === "string" ? d.reason : null };
    case "child.created":
      return { title: "Helper slip carved out", detail: `${amt(d.budget)}${typeof d.intent === "string" ? ` for "${d.intent}"` : ""}` };
    case "guard.verdict": {
      const verdict = obj(d.verdict) as Partial<Verdict>;
      const proposal = obj(d.proposal);
      const decision = verdict.decision ? DECISION_WORDS[verdict.decision] : "checked";
      const first = verdict.violations?.[0] ?? verdict.unknowns?.[0];
      return {
        title: `Guard: ${amt(proposal.amount)} ${String(proposal.kind ?? "proposal")} is ${decision}`,
        detail: first ? `${first.clauseId} · ${first.message}` : null,
      };
    }
    case "rail.order_created":
      return { title: `PayPal order created for ${amt(d.amount)}`, detail: typeof d.orderId === "string" ? d.orderId : null };
    case "rail.authorized":
      return { title: `PayPal hold placed: ${amt(d.amount)}`, detail: typeof d.authorizationId === "string" ? `Authorization ${d.authorizationId}` : null };
    case "rail.captured":
      return {
        title: `Captured ${amt(d.amount)}${d.finalCapture ? " (final)" : ""}`,
        detail: typeof d.captureId === "string" ? `Capture ${d.captureId}` : null,
      };
    case "rail.voided":
      return { title: "Unspent hold released", detail: typeof d.authorizationId === "string" ? `Authorization ${d.authorizationId} voided` : null };
    case "rail.reauthorized":
      return { title: "Hold renewed", detail: typeof d.authorizationId === "string" ? d.authorizationId : null };
    case "rail.refunded":
      return { title: `Refunded ${amt(d.amount)}`, detail: typeof d.reason === "string" ? d.reason : null };
    case "rail.payout_created": {
      const items = Array.isArray(d.items) ? d.items : [];
      return { title: `Payout sent to ${items.length} ${items.length === 1 ? "person" : "people"}`, detail: typeof d.payoutBatchId === "string" ? `Batch ${d.payoutBatchId}` : null };
    }
    case "rail.tracking_added":
      return { title: "Tracking added", detail: `${String(d.carrier ?? "")} ${String(d.trackingNumber ?? "")}`.trim() || null };
    case "rail.invoice_reminder":
      return { title: "Invoice reminder sent", detail: typeof d.invoiceId === "string" ? d.invoiceId : null };
    case "rail.dispute_evidence":
      return { title: "Evidence sent to PayPal", detail: typeof d.disputeId === "string" ? `Dispute ${d.disputeId}` : null };
    case "rail.dispute_accepted":
      return { title: "Dispute claim accepted", detail: typeof d.disputeId === "string" ? `Dispute ${d.disputeId}` : null };
    case "evidence.added":
      return { title: `Evidence: ${String(d.kind ?? "").replace(/_/g, " ")} (${String(d.verdict ?? "?")})`, detail: typeof d.detail === "string" ? d.detail : null };
    case "agent.step": {
      const step = obj(d.step);
      if (step.kind === "tool_call") return { title: `Agent called ${String(step.name)}`, detail: null };
      if (step.kind === "tool_result") return { title: `Agent got a result from ${String(step.name)}`, detail: null };
      if (step.kind === "message") return { title: "Agent", detail: typeof step.text === "string" ? step.text : null };
      return { title: "Agent step", detail: null };
    }
    case "run.step":
      return { title: `Step ${String(d.step ?? "")} done`, detail: d.next ? `Next: ${String(d.next)}` : null };
    case "run.waiting": {
      const wait = obj(d.wait);
      return { title: "Waiting", detail: typeof wait.message === "string" ? wait.message : null };
    }
    case "run.done":
      return { title: "Run finished", detail: null };
    case "run.failed":
      return { title: "Run failed", detail: typeof d.error === "string" ? d.error : null };
    case "webhook.received":
      return { title: `PayPal webhook: ${String(d.eventType ?? "")}`, detail: typeof d.summary === "string" ? d.summary : null };
    case "note":
      return { title: typeof d.message === "string" ? d.message : "Note", detail: null };
    default: {
      const message = typeof d.message === "string" ? d.message : typeof d.summary === "string" ? d.summary : null;
      return { title: e.type.replace(/[._]/g, " "), detail: message };
    }
  }
}
