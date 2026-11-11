/**
 * Evidence documents sent with provide-evidence: a JSON export of the pinned pack (every event with
 * its hashes, so anyone can recompute the chain) and a plain-text summary. Base64 UTF-8, sha256 each.
 */
import { createHash } from "node:crypto";
import type { EvidencePack, RailDispute } from "@/core/contracts";
import { formatMoney } from "@/core/money";
import { describeEvent } from "@/components/event-text";
import { reasonLabel } from "./reasons";
import type { HandoffContext, Recommendation } from "./types";

export const EVIDENCE_DOC_KIND = "permission-slip.dispute-evidence/v1";

export interface EvidenceDocument {
  name: string;
  contentType: "application/json" | "text/plain";
  base64: string;
  sha256: string;
  bytes: number;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function toBase64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

export function fromBase64(base64: string): string {
  return Buffer.from(base64, "base64").toString("utf8");
}

function doc(name: string, contentType: EvidenceDocument["contentType"], text: string): EvidenceDocument {
  const bytes = Buffer.from(text, "utf8");
  return { name, contentType, base64: bytes.toString("base64"), sha256: sha256Hex(bytes), bytes: bytes.length };
}

function safeName(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "_");
}

export function buildEvidenceJson(input: {
  pack: EvidencePack;
  dispute: RailDispute;
  recommendation: Recommendation;
  handoff: HandoffContext | null;
  generatedAt: string;
}): Record<string, unknown> {
  const { pack, dispute, recommendation, handoff } = input;
  const { slip } = pack;
  return {
    kind: EVIDENCE_DOC_KIND,
    dispute: {
      id: dispute.id,
      reason: dispute.reason,
      status: dispute.status,
      amount: dispute.amount,
      transactionId: dispute.transactionId,
      createdAt: dispute.createdAt,
      sellerResponseDueAt: dispute.sellerResponseDueAt,
    },
    slip: {
      id: slip.id,
      pipeline: slip.pipeline,
      clauses: slip.clauses,
      budget: slip.budget,
      spent: slip.spent,
      status: slip.status,
      rail: slip.rail,
      createdAt: slip.createdAt,
    },
    chain: {
      ok: pack.chain.ok,
      brokenAtSeq: pack.chain.brokenAtSeq,
      headHash: pack.events.at(-1)?.hash ?? null,
      eventCount: pack.events.length,
    },
    events: pack.events.map((e) => ({ seq: e.seq, type: e.type, actor: e.actor, at: e.at, data: e.data, prevHash: e.prevHash, hash: e.hash })),
    verdicts: pack.verdicts,
    evidence: pack.evidence,
    handoff: handoff
      ? { captureId: handoff.captureId, orderId: handoff.orderId, trackingNumber: handoff.trackingNumber, carrier: handoff.carrier, status: handoff.status }
      : null,
    cited: { seqs: recommendation.citedSeqs, clauseIds: recommendation.citedClauseIds },
    generatedAt: input.generatedAt,
  };
}

export function buildEvidenceText(input: { pack: EvidencePack; dispute: RailDispute; recommendation: Recommendation }): string {
  const { pack, dispute, recommendation } = input;
  const cited = new Set(recommendation.citedSeqs);
  const lines = [
    `PaySmart evidence for PayPal dispute ${dispute.id}`,
    `Reason: ${reasonLabel(dispute.reason)} (${dispute.reason})`,
    `Amount: ${formatMoney(dispute.amount)}`,
    `Transaction: ${dispute.transactionId ?? "none"}`,
    `Slip: ${pack.slip.id}, status ${pack.slip.status}, budget ${formatMoney(pack.slip.budget)}, spent ${formatMoney(pack.slip.spent)}`,
    `Ledger: ${pack.chain.ok ? "verified" : `broken at #${pack.chain.brokenAtSeq}`}, ${pack.events.length} events, head hash ${pack.events.at(-1)?.hash ?? "none"}`,
    "",
    "Clauses the buyer signed:",
    ...pack.slip.clauses.map((c) => `  ${c.id}  ${c.label}`),
    "",
    "Summary:",
    `  ${pack.summary}`,
    "",
    "Cited ledger events:",
    ...pack.events
      .filter((e) => cited.has(e.seq))
      .map((e) => {
        const { title, detail } = describeEvent(e);
        return `  #${e.seq}  ${e.at}  ${title}${detail ? `: ${detail}` : ""}  (hash ${e.hash.slice(0, 16)})`;
      }),
  ];
  return `${lines.join("\n")}\n`;
}

/** Both documents, or none when the chain fails verification (a broken ledger is never cited). */
export function buildEvidenceDocuments(input: {
  pack: EvidencePack;
  dispute: RailDispute;
  recommendation: Recommendation;
  handoff: HandoffContext | null;
  generatedAt: string;
}): EvidenceDocument[] {
  if (!input.pack.chain.ok) return [];
  const base = `dispute-${safeName(input.dispute.id)}`;
  return [
    doc(`${base}-evidence.json`, "application/json", `${JSON.stringify(buildEvidenceJson(input), null, 2)}\n`),
    doc(`${base}-summary.txt`, "text/plain", buildEvidenceText(input)),
  ];
}
