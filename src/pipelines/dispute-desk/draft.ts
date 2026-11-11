/**
 * Response notes: a deterministic outline (the mock, and the fallback), the live-model prompt, and
 * the composer that keeps notes at 2000 characters with the evidence hash as the last line.
 */
import type { Clause, LedgerEvent, RailDispute } from "@/core/contracts";
import { formatMoney } from "@/core/money";
import { digestEvent } from "./digest";
import { reasonLabel } from "./reasons";
import { NOTES_MAX, type EvidenceType, type Recommendation } from "./types";

export const DRAFT_LABEL = "dispute-desk.draft";
export const DRAFT_SYSTEM = [
  "You write a merchant's response to a PayPal dispute, in plain words, first person plural (we).",
  "Keep it under 1500 characters. Short sentences. No legal language, no greetings, no sign-off.",
  "Refer to ledger events as #<seq> and to clauses by id, using only the ones in the input.",
  "State only facts present in the input. Do not quote or paraphrase the buyer.",
  "If the decision is accept, say plainly that we accept and why. If need_more, list what is missing.",
].join("\n");

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function amt(v: unknown): string | null {
  const o = obj(v);
  return typeof o.value === "string" && typeof o.currency === "string" ? formatMoney({ value: o.value, currency: o.currency }) : null;
}
function day(iso: string): string {
  return iso.slice(0, 10);
}

/** One plain sentence per cited event. */
export function sentenceFor(e: LedgerEvent, clauses: Clause[]): string {
  const d = obj(e.data);
  switch (e.type) {
    case "slip.signed":
      return `The buyer approved the purchase terms on PayPal on ${day(e.at)} (#${e.seq}).`;
    case "slip.created":
      return `The buyer wrote the slip with ${clauses.length} clause${clauses.length === 1 ? "" : "s"} on ${day(e.at)} (#${e.seq}).`;
    case "rail.captured":
      return `We captured ${amt(d.amount) ?? "the payment"} on ${day(e.at)} (#${e.seq}).`;
    case "rail.authorized":
      return `PayPal held ${amt(d.amount) ?? "the budget"} for this order on ${day(e.at)} (#${e.seq}).`;
    case "guard.verdict": {
      const decision = obj(d.verdict).decision;
      return decision === "within"
        ? `Before payment, our guard checked the item against every clause and found it within the slip (#${e.seq}).`
        : `Our guard stopped a proposal that didn't fit the slip (#${e.seq}).`;
    }
    case "rail.tracking_added": {
      const num = typeof d.trackingNumber === "string" ? `${d.trackingNumber} ` : "";
      const carrier = typeof d.carrier === "string" ? `(${d.carrier}) ` : "";
      return `Tracking ${num}${carrier}was added to the PayPal capture on ${day(e.at)} (#${e.seq}).`;
    }
    case "rail.refunded":
      return `We refunded ${amt(d.amount) ?? "the buyer"} on ${day(e.at)}${typeof d.refundId === "string" ? ` (refund ${d.refundId})` : ""} (#${e.seq}).`;
    case "evidence.added": {
      const kind = typeof d.kind === "string" ? d.kind.replace(/_/g, " ") : "evidence";
      if (d.verdict === "pass") return `The ${kind} check passed${typeof d.ref === "string" && d.kind === "tracking" ? ` (${d.ref})` : ""} (#${e.seq}).`;
      if (d.verdict === "fail") return `Our ${kind} check failed${typeof d.detail === "string" && d.detail ? `: ${d.detail}` : ""} (#${e.seq}).`;
      return `A ${kind} record was added (#${e.seq}).`;
    }
    default:
      return `Ledger event ${e.type} (#${e.seq}).`;
  }
}

export function mockDraft(input: {
  dispute: RailDispute;
  recommendation: Recommendation;
  events: LedgerEvent[];
  clauses: Clause[];
}): string {
  const { dispute, recommendation: rec, events, clauses } = input;
  const cited = events.filter((e) => rec.citedSeqs.includes(e.seq)).sort((a, b) => a.seq - b.seq);
  const sentences = cited.map((e) => sentenceFor(e, clauses));
  const clauseLines = rec.citedClauseIds
    .map((id) => clauses.find((c) => c.id === id))
    .filter((c): c is Clause => Boolean(c))
    .map((c) => `Clause ${c.id}: "${c.label}".`);
  const refunded = rec.alreadyRefunded ? `The buyer has already been refunded ${formatMoney(rec.alreadyRefunded.amount)} (#${rec.alreadyRefunded.seq}).` : "";

  if (rec.decision === "contest") {
    return [
      `We're contesting this ${reasonLabel(dispute.reason).toLowerCase()} dispute for ${formatMoney(dispute.amount)}.`,
      ...sentences,
      ...clauseLines,
      "The attached evidence pack holds every ledger record with its hash, so each one can be checked.",
    ].join(" ");
  }
  if (rec.decision === "accept") {
    const dedupedRefund = cited.some((e) => e.type === "rail.refunded") ? "" : refunded;
    return [`We accept this claim.`, ...sentences, ...clauseLines, dedupedRefund, "We're sorry the order didn't match what the buyer signed for."]
      .filter(Boolean)
      .join(" ");
  }
  const missing = rec.missing.length ? ` To answer it we'd need: ${rec.missing.join("; ")}.` : "";
  const opener = dispute.transactionId
    ? `We couldn't find a signed order record for transaction ${dispute.transactionId} yet.`
    : "This dispute doesn't name a transaction we can match to an order record.";
  return `${opener}${missing}`;
}

export function draftPrompt(input: {
  dispute: RailDispute;
  recommendation: Recommendation;
  events: LedgerEvent[];
  clauses: Clause[];
  outline: string;
}): string {
  const { dispute, recommendation: rec, events, clauses, outline } = input;
  return JSON.stringify(
    {
      dispute: { id: dispute.id, reason: dispute.reason, reasonInWords: reasonLabel(dispute.reason), amount: dispute.amount },
      recommendation: {
        decision: rec.decision,
        rationale: rec.rationale,
        citedSeqs: rec.citedSeqs,
        citedClauseIds: rec.citedClauseIds,
        alreadyRefunded: rec.alreadyRefunded,
        missing: rec.missing,
      },
      citedEvents: events.filter((e) => rec.citedSeqs.includes(e.seq)).map(digestEvent),
      citedClauses: clauses.filter((c) => rec.citedClauseIds.includes(c.id)).map((c) => ({ id: c.id, kind: c.kind, label: c.label })),
      outline,
    },
    null,
    1,
  );
}

export function hashFooter(jsonSha256: string): string {
  return `Evidence pack sha256: ${jsonSha256}`;
}

export function brokenChainLine(brokenAtSeq: number | null): string {
  return `Our ledger for this order failed verification at #${brokenAtSeq ?? "?"}, so no ledger records are cited.`;
}

/** Trim the body so body + footer lines fit in NOTES_MAX; footers always survive. */
export function composeNotes(body: string, footers: string[]): string {
  const tail = footers.filter(Boolean);
  const tailText = tail.length ? `\n\n${tail.join("\n")}` : "";
  const room = NOTES_MAX - tailText.length;
  let text = body.trim().replace(/\n{3,}/g, "\n\n");
  if (text.length > room) {
    const cut = text.slice(0, Math.max(0, room - 3));
    const space = cut.lastIndexOf(" ");
    text = `${space > room * 0.6 ? cut.slice(0, space) : cut}...`;
  }
  return `${text}${tailText}`;
}

/** Make sure required footer lines are present in merchant-edited notes, trimming the body if needed. */
export function ensureFooters(notes: string, footers: string[]): string {
  const missing = footers.filter((f) => f && !notes.includes(f));
  if (missing.length === 0) return notes;
  return composeNotes(notes, missing);
}

export function chooseEvidenceType(rec: Recommendation): EvidenceType {
  if (rec.alreadyRefunded) return "PROOF_OF_REFUND";
  if (rec.decision === "contest") return "PROOF_OF_FULFILLMENT";
  return "OTHER";
}
