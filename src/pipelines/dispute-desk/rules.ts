/**
 * One rules table, two jobs: the deterministic AI mock for triage, and the honesty floor that runs
 * after the live model. The floor only blocks contests; conceding is never the dishonest move.
 */
import { formatMoney } from "@/core/money";
import type { DisputeFacts } from "./facts";
import {
  missingForReason,
  REASON_CREDIT_NOT_PROCESSED,
  REASON_NOT_AS_DESCRIBED,
  REASON_NOT_RECEIVED,
  REASON_UNAUTHORISED,
} from "./reasons";
import type { AlreadyRefunded, ModelRecommendation, Recommendation } from "./types";

export type RuleId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type RuleResult = Recommendation & { rule: RuleId };

const GOODS_REASONS = [REASON_NOT_RECEIVED, REASON_NOT_AS_DESCRIBED];

function uniq<T>(xs: (T | null | undefined)[]): T[] {
  return [...new Set(xs.filter((x): x is T => x !== null && x !== undefined))];
}
function seqs(xs: (number | null | undefined)[]): number[] {
  return uniq(xs).sort((a, b) => a - b);
}

export function chainWarning(brokenAtSeq: number | null): string {
  return `The ledger failed verification at #${brokenAtSeq ?? "?"}, so no ledger records were cited.`;
}

function alreadyRefundedOf(f: DisputeFacts): AlreadyRefunded | null {
  if (!f.refund || !f.refund.amount || f.chainOk !== true) return null;
  return { amount: f.refund.amount, seq: f.refund.seq, refundId: f.refund.refundId };
}

function result(
  rule: RuleId,
  f: DisputeFacts,
  parts: Partial<Pick<Recommendation, "missing" | "warnings">> & Pick<Recommendation, "decision" | "confidence" | "rationale" | "citedSeqs" | "citedClauseIds">,
): RuleResult {
  return {
    rule,
    decision: parts.decision,
    confidence: parts.confidence,
    rationale: parts.rationale,
    citedSeqs: parts.citedSeqs,
    citedClauseIds: parts.citedClauseIds,
    missing: parts.missing ?? [],
    alreadyRefunded: alreadyRefundedOf(f),
    override: null,
    warnings: parts.warnings ?? [],
  };
}

function refundLine(f: DisputeFacts): string {
  if (!f.refund) return "";
  const amount = f.refund.amount ? formatMoney(f.refund.amount) : "a refund";
  return ` We already refunded ${amount} (#${f.refund.seq}).`;
}

export function recommendByRules(f: DisputeFacts): RuleResult {
  // 1. No slip behind the dispute.
  if (!f.linked) {
    return result(1, f, {
      decision: "need_more",
      confidence: 0.3,
      rationale: `No slip matches transaction ${f.transactionId ?? "(none)"}, so there's no signed record to cite yet.`,
      citedSeqs: [],
      citedClauseIds: [],
      missing: [`The order record for transaction ${f.transactionId ?? "(none)"}`, ...missingForReason(f.reason)],
    });
  }
  // 2. Broken chain: refuse to cite anything.
  if (f.chainOk === false) {
    return result(2, f, {
      decision: "need_more",
      confidence: 0.2,
      rationale: `The slip's ledger failed verification at #${f.brokenAtSeq ?? "?"}. A record that fails its hash check can't back a response, so nothing from it is cited.`,
      citedSeqs: [],
      citedClauseIds: [],
      missing: ["A ledger that verifies, or evidence from outside the ledger"],
      warnings: [chainWarning(f.brokenAtSeq)],
    });
  }
  const goods = GOODS_REASONS.includes(f.reason);
  // 3. Our own delivery check failed a clause: accept.
  if (f.deliveryFail && goods) {
    const clause = f.deliveryFail.clauseId ? `clause ${f.deliveryFail.clauseId}` : "the slip";
    return result(3, f, {
      decision: "accept",
      confidence: 0.9,
      rationale: `Our delivery check failed ${clause} at #${f.deliveryFail.seq}${f.deliveryFail.detail ? ` (${f.deliveryFail.detail})` : ""}. The slip shows the order broke the terms the buyer signed, so contesting would be dishonest.${refundLine(f)}`,
      citedSeqs: seqs([f.deliveryFail.seq, f.refund?.seq]),
      citedClauseIds: uniq([f.deliveryFail.clauseId]),
    });
  }
  // 4. Refund already on file for the same complaint.
  if (f.refund && goods) {
    return result(4, f, {
      decision: "accept",
      confidence: 0.8,
      rationale: `The buyer was already refunded for this order (#${f.refund.seq}). Accepting closes the dispute without arguing a point we already conceded.`,
      citedSeqs: seqs([f.refund.seq]),
      citedClauseIds: [],
    });
  }
  // 5. Buyer says the refund never came, and the ledger shows it did.
  if (f.refund && f.reason === REASON_CREDIT_NOT_PROCESSED) {
    return result(5, f, {
      decision: "contest",
      confidence: 0.85,
      rationale: `The ledger records the refund at #${f.refund.seq}${f.refund.refundId ? ` (refund ${f.refund.refundId})` : ""}.`,
      citedSeqs: seqs([f.refund.seq, f.capture?.seq]),
      citedClauseIds: [],
    });
  }
  // 6. Not received, with tracking or a passing delivery check.
  if (f.reason === REASON_NOT_RECEIVED && (f.tracking || f.deliveryPass)) {
    const proof = f.tracking
      ? `tracking ${f.tracking.ref ? `${f.tracking.ref} ` : ""}was recorded at #${f.tracking.seq}`
      : `the delivery check passed at #${f.deliveryPass!.seq}`;
    return result(6, f, {
      decision: "contest",
      confidence: 0.8,
      rationale: `The buyer approved the slip${f.signed ? ` (#${f.signed.seq})` : ""}, the payment was captured${f.capture ? ` (#${f.capture.seq})` : ""}, and ${proof}.`,
      citedSeqs: seqs([f.signed?.seq, f.capture?.seq, f.tracking?.seq, f.deliveryPass?.seq]),
      citedClauseIds: uniq([f.deliveryPass?.clauseId]),
    });
  }
  // 7. Not as described, but the guard passed the item and the delivery check passed.
  if (f.reason === REASON_NOT_AS_DESCRIBED && f.deliveryPass && f.withinVerdictBeforeCapture) {
    const clauseIds = f.deliveryPass.clauseId ? [f.deliveryPass.clauseId] : f.clauseIds.slice(0, 4);
    return result(7, f, {
      decision: "contest",
      confidence: 0.7,
      rationale: `Before payment the guard found the item within every clause the buyer signed (#${f.withinVerdictBeforeCapture.seq}), and the delivery check passed (#${f.deliveryPass.seq}).`,
      citedSeqs: seqs([f.signed?.seq, f.withinVerdictBeforeCapture.seq, f.deliveryPass.seq]),
      citedClauseIds: clauseIds,
    });
  }
  // 8. Unauthorised, but the buyer signed the slip on PayPal.
  if (f.reason === REASON_UNAUTHORISED && f.signed) {
    return result(8, f, {
      decision: "contest",
      confidence: 0.6,
      rationale: `The buyer approved this payment on PayPal when signing the slip (#${f.signed.seq}).`,
      citedSeqs: seqs([f.signed.seq, f.capture?.seq]),
      citedClauseIds: [],
    });
  }
  // 9. Not enough on file.
  return result(9, f, {
    decision: "need_more",
    confidence: 0.4,
    rationale: "The slip doesn't hold the record this kind of dispute needs.",
    citedSeqs: seqs([f.signed?.seq, f.capture?.seq]),
    citedClauseIds: [],
    missing: missingForReason(f.reason),
  });
}

/** The deterministic stand-in for the model (mock mode). */
export function modelFromRules(r: RuleResult): ModelRecommendation {
  return {
    decision: r.decision,
    confidence: r.confidence,
    rationale: r.rationale,
    citedSeqs: r.citedSeqs,
    citedClauseIds: r.citedClauseIds,
  };
}

/** Strip the rule id for storage. */
export function toRecommendation(r: RuleResult): Recommendation {
  const { rule: _rule, ...rec } = r;
  void _rule;
  return rec;
}

/** Applies the honesty floor to the model's answer. */
export function applyHonestyFloor(model: ModelRecommendation, rules: RuleResult, f: DisputeFacts): Recommendation {
  // Unlinked or broken chain: the model's answer is replaced outright.
  if (rules.rule === 1 || rules.rule === 2) return toRecommendation(rules);

  const validSeqs = new Set(f.validSeqs);
  const validClauses = new Set(f.clauseIds);
  let citedSeqs = seqs(model.citedSeqs.filter((s) => validSeqs.has(s)));
  let citedClauseIds = uniq(model.citedClauseIds.filter((c) => validClauses.has(c)));
  let decision = model.decision;
  let rationale = model.rationale;
  let override: Recommendation["override"] = null;

  if (rules.rule === 3 && decision === "contest") {
    const reason = `Our delivery check failed ${f.deliveryFail?.clauseId ? `clause ${f.deliveryFail.clauseId}` : "the slip"} at #${f.deliveryFail?.seq}, so the slip doesn't support a contest.`;
    override = { from: "contest", reason };
    decision = "accept";
    citedSeqs = seqs([...citedSeqs, ...rules.citedSeqs]);
    citedClauseIds = uniq([...citedClauseIds, ...rules.citedClauseIds]);
    rationale = `${reason} ${rules.rationale}`;
  }
  if (decision === "contest" && citedSeqs.length === 0) {
    const reason = "No ledger record supports a contest.";
    override = { from: "contest", reason };
    decision = "need_more";
    rationale = `${reason} ${model.rationale}`;
  }
  return {
    decision,
    confidence: model.confidence,
    rationale,
    citedSeqs,
    citedClauseIds,
    missing: decision === "need_more" ? (rules.missing.length ? rules.missing : missingForReason(f.reason)) : [],
    alreadyRefunded: rules.alreadyRefunded,
    override,
    warnings: rules.warnings,
  };
}
