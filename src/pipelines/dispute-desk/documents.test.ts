import { describe, expect, it } from "vitest";
import type { RailDispute } from "@/core/contracts";
import { tamperEvent } from "@/core/testing";
import { buildEvidenceDocuments, EVIDENCE_DOC_KIND, fromBase64, sha256Hex } from "./documents";
import { deriveFacts } from "./facts";
import { claimFromReason } from "./quarantine";
import { REASON_NOT_RECEIVED } from "./reasons";
import { recommendByRules, toRecommendation } from "./rules";
import { deskRuntime, notReceivedHistory } from "./testkit";

async function setup(tamper = false) {
  const rt = deskRuntime();
  const { slipId, captureId } = await notReceivedHistory(rt);
  if (tamper) tamperEvent(rt.store, slipId, 3);
  const pack = await rt.core.evidencePack(slipId);
  const dispute: RailDispute = {
    id: "PP-D-DOC/1",
    reason: REASON_NOT_RECEIVED,
    status: "WAITING_FOR_SELLER_RESPONSE",
    amount: pack.slip.spent,
    createdAt: "2026-11-08T00:00:00.000Z",
    sellerResponseDueAt: null,
    transactionId: captureId,
    buyerEmail: "ada@example.com",
    messages: ["never came"],
  };
  const rec = toRecommendation(recommendByRules(deriveFacts({ dispute, claim: claimFromReason(dispute.reason), pack })));
  const docs = buildEvidenceDocuments({ pack, dispute, recommendation: rec, handoff: null, generatedAt: "2026-11-10T12:00:00.000Z" });
  return { rt, slipId, pack, rec, docs };
}

describe("buildEvidenceDocuments", () => {
  it("JSON document decodes and its event hashes equal the ledger's", async () => {
    const { rt, slipId, rec, docs } = await setup();
    expect(docs.map((d) => [d.name, d.contentType])).toEqual([
      ["dispute-PP-D-DOC_1-evidence.json", "application/json"],
      ["dispute-PP-D-DOC_1-summary.txt", "text/plain"],
    ]);
    const json = JSON.parse(fromBase64(docs[0].base64)) as {
      kind: string;
      chain: { ok: boolean; headHash: string; eventCount: number };
      events: { seq: number; hash: string; prevHash: string }[];
      cited: { seqs: number[] };
    };
    expect(json.kind).toBe(EVIDENCE_DOC_KIND);
    const ledger = rt.store.ledger.list(slipId);
    for (const e of json.events) {
      const real = ledger.find((x) => x.seq === e.seq)!;
      expect(e.hash).toBe(real.hash);
      expect(e.prevHash).toBe(real.prevHash);
    }
    expect(json.chain.ok).toBe(true);
    expect(json.chain.headHash).toBe(json.events.at(-1)!.hash);
    expect(json.cited.seqs).toEqual(rec.citedSeqs);
    const text = fromBase64(docs[1].base64);
    expect(text).toContain("Ledger: verified");
    for (const seq of rec.citedSeqs) expect(text).toContain(`#${seq}`);
    expect(text).not.toContain("never came");
  });

  it("sha256 matches the decoded bytes", async () => {
    const { docs } = await setup();
    for (const d of docs) {
      const bytes = Buffer.from(d.base64, "base64");
      expect(d.sha256).toBe(sha256Hex(bytes));
      expect(d.bytes).toBe(bytes.length);
    }
  });

  it("broken chain builds no documents", async () => {
    const { pack, docs } = await setup(true);
    expect(pack.chain.ok).toBe(false);
    expect(docs).toEqual([]);
  });
});
