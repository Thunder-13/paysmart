/**
 * Typed facts from a pinned evidence pack. Reads typed pack fields first and touches event data
 * only through tolerant parsers that return null instead of throwing.
 */
import { MoneySchema, type EvidenceKind, type EvidencePack, type LedgerEvent, type Money, type RailDispute } from "@/core/contracts";
import { addMoney } from "@/core/money";
import type { BuyerClaim } from "./types";

export const DELIVERY_KINDS: EvidenceKind[] = ["delivery_photo", "before_after_photos", "work_product"];

export interface DisputeFacts {
  disputeId: string;
  reason: string;
  transactionId: string | null;
  disputeAmount: Money;
  claim: BuyerClaim;
  linked: boolean;
  slipId: string | null;
  /** null when unlinked. */
  chainOk: boolean | null;
  brokenAtSeq: number | null;
  /** Seqs a recommendation may cite (every event in the pack). */
  validSeqs: number[];
  clauseIds: string[];
  signed: { seq: number } | null;
  capture: { seq: number; captureId: string | null; amount: Money | null } | null;
  withinVerdictBeforeCapture: { seq: number } | null;
  tracking: { seq: number; ref: string | null } | null;
  deliveryPass: { seq: number; kind: EvidenceKind; clauseId: string | null } | null;
  deliveryFail: { seq: number; kind: EvidenceKind; clauseId: string | null; detail: string } | null;
  refund: { seq: number; amount: Money | null; refundId: string | null } | null;
  /** Proposals the guard stopped before money moved. Shown, never treated as a breach. */
  blockedProposals: number;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}
function moneyOf(v: unknown): Money | null {
  const parsed = MoneySchema.safeParse(v);
  return parsed.success ? parsed.data : null;
}
function verdictDecision(e: LedgerEvent): string | null {
  const verdict = obj(obj(e.data)?.verdict);
  return str(verdict?.decision);
}
function evidenceOf(e: LedgerEvent): { kind: string; verdict: string; detail: string; ref: string | null } | null {
  const d = obj(e.data);
  const kind = str(d?.kind);
  const verdict = str(d?.verdict);
  if (!kind || !verdict) return null;
  return { kind, verdict, detail: typeof d?.detail === "string" ? d.detail : "", ref: str(d?.ref) };
}

/** Clause a failed or passed delivery check refers to: an id named in the detail, else the require_evidence clause. */
function clauseForEvidence(pack: EvidencePack, kind: string, detail: string): string | null {
  const ids = pack.slip.clauses.map((c) => c.id);
  for (const m of detail.matchAll(/\b([a-z]+\d+)\b/gi)) {
    if (ids.includes(m[1])) return m[1];
  }
  const req = pack.slip.clauses.find((c) => c.kind === "require_evidence" && c.evidence === kind);
  return req?.id ?? null;
}

export function deriveFacts(input: { dispute: RailDispute; claim: BuyerClaim; pack: EvidencePack | null }): DisputeFacts {
  const { dispute, claim, pack } = input;
  const base: DisputeFacts = {
    disputeId: dispute.id,
    reason: dispute.reason,
    transactionId: dispute.transactionId,
    disputeAmount: dispute.amount,
    claim,
    linked: pack !== null,
    slipId: pack?.slip.id ?? null,
    chainOk: pack ? pack.chain.ok : null,
    brokenAtSeq: pack ? pack.chain.brokenAtSeq : null,
    validSeqs: [],
    clauseIds: [],
    signed: null,
    capture: null,
    withinVerdictBeforeCapture: null,
    tracking: null,
    deliveryPass: null,
    deliveryFail: null,
    refund: null,
    blockedProposals: 0,
  };
  if (!pack) return base;

  const events = [...pack.events].sort((a, b) => a.seq - b.seq);
  base.validSeqs = events.map((e) => e.seq);
  base.clauseIds = pack.slip.clauses.map((c) => c.id);

  const signed = events.find((e) => e.type === "slip.signed");
  if (signed) base.signed = { seq: signed.seq };

  // The capture the dispute is about, else the first capture on the slip.
  const captures = events
    .filter((e) => e.type === "rail.captured")
    .map((e) => ({ seq: e.seq, captureId: str(obj(e.data)?.captureId), amount: moneyOf(obj(e.data)?.amount) }));
  base.capture = captures.find((c) => c.captureId && c.captureId === dispute.transactionId) ?? captures[0] ?? null;

  const verdicts = events.filter((e) => e.type === "guard.verdict");
  base.blockedProposals = verdicts.filter((e) => verdictDecision(e) === "outside").length;
  if (base.capture) {
    const captureSeq = base.capture.seq;
    const within = verdicts.filter((e) => e.seq < captureSeq && verdictDecision(e) === "within").at(-1);
    if (within) base.withinVerdictBeforeCapture = { seq: within.seq };
  }

  // Tracking: a passing tracking evidence entry or a tracking number added to the PayPal capture.
  for (const e of events) {
    if (e.type === "rail.tracking_added") {
      base.tracking = { seq: e.seq, ref: str(obj(e.data)?.trackingNumber) };
    } else if (e.type === "evidence.added") {
      const ev = evidenceOf(e);
      if (ev?.kind === "tracking" && ev.verdict === "pass") base.tracking = { seq: e.seq, ref: ev.ref };
    }
  }

  // The latest delivery check decides: a later pass supersedes an earlier fail and vice versa.
  const delivery = events
    .filter((e) => e.type === "evidence.added")
    .map((e) => ({ e, ev: evidenceOf(e) }))
    .filter((x) => x.ev && DELIVERY_KINDS.includes(x.ev.kind as EvidenceKind) && (x.ev.verdict === "pass" || x.ev.verdict === "fail"))
    .at(-1);
  if (delivery?.ev) {
    const kind = delivery.ev.kind as EvidenceKind;
    const clauseId = clauseForEvidence(pack, kind, delivery.ev.detail);
    if (delivery.ev.verdict === "fail") {
      base.deliveryFail = { seq: delivery.e.seq, kind, clauseId, detail: delivery.ev.detail };
    } else {
      base.deliveryPass = { seq: delivery.e.seq, kind, clauseId };
    }
  }

  // Refunds on the disputed capture, summed. When the dispute's transaction id isn't one of this
  // slip's captures (linked through a handoff order id), every refund on the slip counts.
  const allRefunds = events
    .filter((e) => e.type === "rail.refunded")
    .map((e) => ({ seq: e.seq, captureId: str(obj(e.data)?.captureId), refundId: str(obj(e.data)?.refundId), amount: moneyOf(obj(e.data)?.amount) }));
  const onCapture = allRefunds.filter((r) => r.captureId !== null && r.captureId === dispute.transactionId);
  const transactionIsCapture = captures.some((c) => c.captureId === dispute.transactionId);
  const refunds = onCapture.length > 0 ? onCapture : transactionIsCapture ? [] : allRefunds;
  if (refunds.length > 0) {
    let total: Money | null = null;
    for (const r of refunds) {
      if (!r.amount) continue;
      try {
        total = total ? addMoney(total, r.amount) : r.amount;
      } catch {
        // Mixed currencies: keep the first total.
      }
    }
    const last = refunds[refunds.length - 1];
    base.refund = { seq: last.seq, amount: total, refundId: last.refundId };
  }
  return base;
}
