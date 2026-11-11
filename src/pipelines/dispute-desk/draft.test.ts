import { describe, expect, it } from "vitest";
import type { RailDispute } from "@/core/contracts";
import { money } from "@/core/money";
import { buildEvidenceDocuments } from "./documents";
import { brokenChainLine, chooseEvidenceType, composeNotes, ensureFooters, hashFooter, mockDraft } from "./draft";
import { deriveFacts } from "./facts";
import { claimFromReason } from "./quarantine";
import { REASON_NOT_RECEIVED } from "./reasons";
import { recommendByRules, toRecommendation } from "./rules";
import { deskRuntime, notReceivedHistory, TRACKING_NUMBER } from "./testkit";
import { NOTES_MAX } from "./types";

function dispute(transactionId: string | null): RailDispute {
  return {
    id: "PP-D-DR",
    reason: REASON_NOT_RECEIVED,
    status: "WAITING_FOR_SELLER_RESPONSE",
    amount: money("48.00"),
    createdAt: "2026-11-08T00:00:00.000Z",
    sellerResponseDueAt: null,
    transactionId,
    buyerEmail: null,
    messages: [],
  };
}

describe("draft", () => {
  it("contest notes cite seqs and end with the JSON sha256", async () => {
    const rt = deskRuntime();
    const { slipId, captureId } = await notReceivedHistory(rt);
    const pack = await rt.core.evidencePack(slipId);
    const d = dispute(captureId);
    const rec = toRecommendation(recommendByRules(deriveFacts({ dispute: d, claim: claimFromReason(d.reason), pack })));
    expect(rec.decision).toBe("contest");
    const body = mockDraft({ dispute: d, recommendation: rec, events: pack.events, clauses: pack.slip.clauses });
    for (const seq of rec.citedSeqs) expect(body).toContain(`#${seq}`);
    expect(body).toContain(TRACKING_NUMBER);
    const docs = buildEvidenceDocuments({ pack, dispute: d, recommendation: rec, handoff: null, generatedAt: "2026-11-10T12:00:00.000Z" });
    const notes = composeNotes(body, [hashFooter(docs[0].sha256)]);
    expect(notes.length).toBeLessThanOrEqual(NOTES_MAX);
    expect(notes.endsWith(`Evidence pack sha256: ${docs[0].sha256}`)).toBe(true);
    expect(chooseEvidenceType(rec)).toBe("PROOF_OF_FULFILLMENT");
  });

  it("notes never exceed 2000 characters with a 5000-character model draft", () => {
    const footer = hashFooter("a".repeat(64));
    const notes = composeNotes("word ".repeat(1000), [brokenChainLine(4), footer]);
    expect(notes.length).toBeLessThanOrEqual(NOTES_MAX);
    expect(notes).toContain(brokenChainLine(4));
    expect(notes.endsWith(footer)).toBe(true);
  });

  it("need_more draft lists missing evidence for an unlinked dispute", () => {
    const d = dispute("CAP-NOBODY");
    const rec = toRecommendation(recommendByRules(deriveFacts({ dispute: d, claim: claimFromReason(d.reason), pack: null })));
    const body = mockDraft({ dispute: d, recommendation: rec, events: [], clauses: [] });
    expect(body).toContain("CAP-NOBODY");
    expect(body).toContain("A tracking number or proof of delivery");
    expect(body).toContain("order record");
  });

  it("ensureFooters puts a removed footer back", () => {
    const line = brokenChainLine(2);
    expect(ensureFooters("We disagree.", [line])).toBe(`We disagree.\n\n${line}`);
    expect(ensureFooters(`We disagree.\n\n${line}`, [line])).toBe(`We disagree.\n\n${line}`);
  });
});
