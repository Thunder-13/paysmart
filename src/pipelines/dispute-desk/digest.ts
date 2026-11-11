/**
 * Event digests for prompts. Only whitelisted fields leave the ledger: ids, amounts, decisions,
 * clause ids, evidence kinds. Listing titles, agent rationales and slip intent never reach a prompt.
 */
import type { LedgerEvent } from "@/core/contracts";

export interface EventDigest {
  seq: number;
  type: string;
  actor: string;
  at: string;
  facts: Record<string, unknown>;
}

const SKIP_TYPES = new Set(["run.step", "run.waiting", "run.done", "run.failed", "agent.step", "note"]);
const SAFE_KEYS = [
  "orderId",
  "authorizationId",
  "captureId",
  "refundId",
  "payoutBatchId",
  "amount",
  "budget",
  "finalCapture",
  "trackingNumber",
  "carrier",
  "status",
  "from",
  "to",
  "disputeId",
  "decision",
  "kind",
  "verdict",
];

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function clip(v: unknown): unknown {
  if (typeof v === "string") return v.length > 80 ? `${v.slice(0, 80)}...` : v;
  return v;
}

export function digestEvent(e: LedgerEvent): EventDigest {
  const d = obj(e.data);
  const facts: Record<string, unknown> = {};
  if (e.type === "guard.verdict") {
    const verdict = obj(d.verdict);
    const proposal = obj(d.proposal);
    facts.decision = verdict.decision ?? null;
    facts.proposalKind = proposal.kind ?? null;
    facts.amount = proposal.amount ?? null;
    facts.violations = Array.isArray(verdict.violations) ? verdict.violations.map((v) => obj(v).clauseId) : [];
  } else if (e.type === "slip.created") {
    facts.clauseIds = Array.isArray(d.clauses) ? d.clauses.map((c) => obj(c).id) : [];
    facts.budget = d.budget ?? null;
  } else {
    for (const k of SAFE_KEYS) if (k in d && typeof d[k] !== "object") facts[k] = clip(d[k]);
    for (const k of ["amount", "budget"]) if (d[k] && typeof d[k] === "object") facts[k] = d[k];
  }
  return { seq: e.seq, type: e.type, actor: e.actor, at: e.at, facts };
}

/** Digests for the prompt: no run bookkeeping, newest 80 at most. */
export function digestEvents(events: LedgerEvent[]): EventDigest[] {
  return events.filter((e) => !SKIP_TYPES.has(e.type)).slice(-80).map(digestEvent);
}
