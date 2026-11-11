import { describe, expect, it } from "vitest";
import type { RailDispute } from "@/core/contracts";
import { money } from "@/core/money";
import { tamperEvent } from "@/core/testing";
import { deriveFacts, type DisputeFacts } from "./facts";
import { claimFromReason } from "./quarantine";
import { REASON_CREDIT_NOT_PROCESSED, REASON_NOT_AS_DESCRIBED, REASON_NOT_RECEIVED, REASON_UNAUTHORISED } from "./reasons";
import { applyHonestyFloor, recommendByRules } from "./rules";
import { deskRuntime, notReceivedHistory } from "./testkit";

function facts(over: Partial<DisputeFacts> = {}): DisputeFacts {
  return {
    disputeId: "PP-D-1",
    reason: REASON_NOT_RECEIVED,
    transactionId: "CAP-1",
    disputeAmount: money("48.00"),
    claim: claimFromReason(over.reason ?? REASON_NOT_RECEIVED),
    linked: true,
    slipId: "slip_1",
    chainOk: true,
    brokenAtSeq: null,
    validSeqs: Array.from({ length: 14 }, (_, i) => i + 1),
    clauseIds: ["c1", "c2", "c3", "c4"],
    signed: { seq: 3 },
    capture: { seq: 6, captureId: "CAP-1", amount: money("48.00") },
    withinVerdictBeforeCapture: { seq: 5 },
    tracking: null,
    deliveryPass: null,
    deliveryFail: null,
    refund: null,
    blockedProposals: 0,
    ...over,
  };
}

describe("recommendByRules", () => {
  it("rule 1: unlinked -> need_more with missing items", () => {
    const r = recommendByRules(facts({ linked: false, chainOk: null, validSeqs: [], clauseIds: [], signed: null, capture: null, withinVerdictBeforeCapture: null }));
    expect(r).toMatchObject({ rule: 1, decision: "need_more", confidence: 0.3, citedSeqs: [], citedClauseIds: [] });
    expect(r.missing[0]).toMatch(/order record for transaction CAP-1/);
  });

  it("rule 2: broken chain -> need_more, nothing cited", () => {
    const r = recommendByRules(facts({ chainOk: false, brokenAtSeq: 4, tracking: { seq: 9, ref: "1Z" } }));
    expect(r).toMatchObject({ rule: 2, decision: "need_more", confidence: 0.2, citedSeqs: [], citedClauseIds: [], alreadyRefunded: null });
    expect(r.warnings.join(" ")).toMatch(/#4/);
  });

  it("rule 3: failed delivery check -> accept citing the event and clause", () => {
    const r = recommendByRules(
      facts({ reason: REASON_NOT_AS_DESCRIBED, deliveryFail: { seq: 9, kind: "delivery_photo", clauseId: "c2", detail: "battery compartment" }, refund: { seq: 11, amount: money("24.00"), refundId: "R-1" } }),
    );
    expect(r).toMatchObject({ rule: 3, decision: "accept", confidence: 0.9, citedSeqs: [9, 11], citedClauseIds: ["c2"] });
    expect(r.alreadyRefunded).toEqual({ amount: money("24.00"), seq: 11, refundId: "R-1" });
  });

  it("rule 4: refund on file for a goods complaint -> accept, already refunded", () => {
    const r = recommendByRules(facts({ refund: { seq: 12, amount: money("48.00"), refundId: "R-2" } }));
    expect(r).toMatchObject({ rule: 4, decision: "accept", confidence: 0.8, citedSeqs: [12] });
    expect(r.alreadyRefunded?.seq).toBe(12);
  });

  it("rule 5: refund not received but refund on file -> contest", () => {
    const r = recommendByRules(facts({ reason: REASON_CREDIT_NOT_PROCESSED, refund: { seq: 12, amount: money("48.00"), refundId: "R-2" } }));
    expect(r).toMatchObject({ rule: 5, decision: "contest", confidence: 0.85, citedSeqs: [6, 12] });
  });

  it("rule 6: not received with tracking -> contest", () => {
    const r = recommendByRules(facts({ tracking: { seq: 9, ref: "1Z999" } }));
    expect(r).toMatchObject({ rule: 6, decision: "contest", confidence: 0.8, citedSeqs: [3, 6, 9] });
    expect(r.rationale).toMatch(/1Z999/);
  });

  it("rule 7: not as described with a passing delivery check and guard pass -> contest", () => {
    const r = recommendByRules(facts({ reason: REASON_NOT_AS_DESCRIBED, deliveryPass: { seq: 10, kind: "delivery_photo", clauseId: "c4" } }));
    expect(r).toMatchObject({ rule: 7, decision: "contest", confidence: 0.7, citedSeqs: [3, 5, 10], citedClauseIds: ["c4"] });
  });

  it("rule 8: unauthorised but signed -> contest", () => {
    const r = recommendByRules(facts({ reason: REASON_UNAUTHORISED }));
    expect(r).toMatchObject({ rule: 8, decision: "contest", confidence: 0.6, citedSeqs: [3, 6] });
  });

  it("rule 9: not received without tracking -> need_more", () => {
    const r = recommendByRules(facts());
    expect(r).toMatchObject({ rule: 9, decision: "need_more", confidence: 0.4, citedSeqs: [3, 6] });
    expect(r.missing).toEqual(["A tracking number or proof of delivery"]);
  });
});

describe("applyHonestyFloor", () => {
  it("drops seqs and clause ids not in the pack", () => {
    const f = facts({ tracking: { seq: 9, ref: "1Z" } });
    const rec = applyHonestyFloor({ decision: "contest", confidence: 0.7, rationale: "Tracked.", citedSeqs: [3, 99], citedClauseIds: ["c2", "c9"] }, recommendByRules(f), f);
    expect(rec.citedSeqs).toEqual([3]);
    expect(rec.citedClauseIds).toEqual(["c2"]);
    expect(rec.decision).toBe("contest");
    expect(rec.override).toBeNull();
  });

  it("contest with no surviving citation becomes need_more", () => {
    const f = facts({ tracking: { seq: 9, ref: "1Z" } });
    const rec = applyHonestyFloor({ decision: "contest", confidence: 0.9, rationale: "Trust me.", citedSeqs: [99], citedClauseIds: [] }, recommendByRules(f), f);
    expect(rec.decision).toBe("need_more");
    expect(rec.override?.from).toBe("contest");
    expect(rec.rationale).toMatch(/^No ledger record supports a contest/);
  });

  it("model contest with a failed delivery check becomes accept with override", () => {
    const f = facts({ reason: REASON_NOT_AS_DESCRIBED, deliveryFail: { seq: 9, kind: "delivery_photo", clauseId: "c3", detail: "" } });
    const rec = applyHonestyFloor({ decision: "contest", confidence: 0.8, rationale: "Shipped fine.", citedSeqs: [6], citedClauseIds: [] }, recommendByRules(f), f);
    expect(rec.decision).toBe("accept");
    expect(rec.override?.reason).toMatch(/clause c3 at #9/);
    expect(rec.citedSeqs).toEqual([6, 9]);
    expect(rec.citedClauseIds).toEqual(["c3"]);
  });

  it("alreadyRefunded comes from facts even when the model omits it", () => {
    const f = facts({ refund: { seq: 12, amount: money("48.00"), refundId: "R-2" } });
    const rec = applyHonestyFloor({ decision: "accept", confidence: 0.6, rationale: "Refunded.", citedSeqs: [], citedClauseIds: [] }, recommendByRules(f), f);
    expect(rec.alreadyRefunded).toEqual({ amount: money("48.00"), seq: 12, refundId: "R-2" });
  });

  it("a model accept stands even when the rules would contest", () => {
    const f = facts({ tracking: { seq: 9, ref: "1Z" } });
    const rec = applyHonestyFloor({ decision: "accept", confidence: 0.5, rationale: "Not worth it.", citedSeqs: [9], citedClauseIds: [] }, recommendByRules(f), f);
    expect(rec.decision).toBe("accept");
  });

  it("tampered chain yields no citations and a warning", async () => {
    const rt = deskRuntime();
    const { slipId, captureId } = await notReceivedHistory(rt);
    tamperEvent(rt.store, slipId, 4);
    const pack = await rt.core.evidencePack(slipId);
    expect(pack.chain).toEqual({ ok: false, brokenAtSeq: 4 });
    const d: RailDispute = {
      id: "PP-D-T",
      reason: REASON_NOT_RECEIVED,
      status: "WAITING_FOR_SELLER_RESPONSE",
      amount: money("48.00"),
      createdAt: "2026-11-08T00:00:00.000Z",
      sellerResponseDueAt: null,
      transactionId: captureId,
      buyerEmail: null,
      messages: [],
    };
    const f = deriveFacts({ dispute: d, claim: claimFromReason(d.reason), pack });
    const rules = recommendByRules(f);
    const rec = applyHonestyFloor({ decision: "contest", confidence: 0.9, rationale: "Tracked.", citedSeqs: [3, 6], citedClauseIds: ["c1"] }, rules, f);
    expect(rec.decision).toBe("need_more");
    expect(rec.citedSeqs).toEqual([]);
    expect(rec.citedClauseIds).toEqual([]);
    expect(rec.warnings.join(" ")).toContain("#4");
  });
});
