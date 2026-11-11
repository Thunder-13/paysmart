import { describe, expect, it } from "vitest";
import type { RailDispute } from "@/core/contracts";
import { money } from "@/core/money";
import { deriveFacts } from "./facts";
import { claimFromReason } from "./quarantine";
import { REASON_NOT_AS_DESCRIBED, REASON_NOT_RECEIVED } from "./reasons";
import { recommendByRules } from "./rules";
import { deskRuntime, notAsDescribedHistory, notReceivedHistory, TRACKING_NUMBER } from "./testkit";

function dispute(reason: string, transactionId: string): RailDispute {
  return {
    id: "PP-D-T1",
    reason,
    status: "WAITING_FOR_SELLER_RESPONSE",
    amount: money("48.00"),
    createdAt: "2026-11-08T12:00:00.000Z",
    sellerResponseDueAt: "2026-11-12T00:00:00.000Z",
    transactionId,
    buyerEmail: "ada@example.com",
    messages: [],
  };
}

function seqOf(rt: ReturnType<typeof deskRuntime>, slipId: string, type: string): number {
  const e = rt.store.ledger.list(slipId).filter((x) => x.type === type).at(-1);
  if (!e) throw new Error(`no ${type}`);
  return e.seq;
}

describe("deriveFacts", () => {
  it("finds signed, capture, tracking, delivery fail and refund seqs", async () => {
    const rt = deskRuntime();
    const a = await notReceivedHistory(rt);
    const packA = await rt.core.evidencePack(a.slipId);
    const fa = deriveFacts({ dispute: dispute(REASON_NOT_RECEIVED, a.captureId), claim: claimFromReason(REASON_NOT_RECEIVED), pack: packA });
    expect(fa.linked).toBe(true);
    expect(fa.chainOk).toBe(true);
    expect(fa.signed?.seq).toBe(seqOf(rt, a.slipId, "slip.signed"));
    expect(fa.capture).toMatchObject({ seq: seqOf(rt, a.slipId, "rail.captured"), captureId: a.captureId, amount: money("48.00") });
    expect(fa.withinVerdictBeforeCapture?.seq).toBe(seqOf(rt, a.slipId, "guard.verdict"));
    expect(fa.tracking).toEqual({ seq: seqOf(rt, a.slipId, "evidence.added"), ref: TRACKING_NUMBER });
    expect(fa.deliveryFail).toBeNull();
    expect(fa.refund).toBeNull();
    expect(fa.clauseIds).toEqual(["c1", "c2", "c3"]);

    const b = await notAsDescribedHistory(rt);
    const packB = await rt.core.evidencePack(b.slipId);
    const fb = deriveFacts({ dispute: dispute(REASON_NOT_AS_DESCRIBED, b.captureId), claim: claimFromReason(REASON_NOT_AS_DESCRIBED), pack: packB });
    expect(fb.deliveryFail).toMatchObject({ seq: seqOf(rt, b.slipId, "evidence.added"), kind: "delivery_photo", clauseId: "c2" });
    expect(fb.refund).toMatchObject({ seq: seqOf(rt, b.slipId, "rail.refunded"), amount: money("48.00") });
    expect(fb.refund?.refundId).toBeTruthy();
  });

  it("an outside verdict before a within verdict and capture is not a breach", async () => {
    const rt = deskRuntime();
    const a = await notReceivedHistory(rt, { blockedFirst: true });
    const pack = await rt.core.evidencePack(a.slipId);
    const f = deriveFacts({ dispute: dispute(REASON_NOT_RECEIVED, a.captureId), claim: claimFromReason(REASON_NOT_RECEIVED), pack });
    const verdicts = rt.store.ledger.list(a.slipId).filter((e) => e.type === "guard.verdict");
    expect(verdicts).toHaveLength(2);
    expect(f.blockedProposals).toBe(1);
    expect(f.withinVerdictBeforeCapture?.seq).toBe(verdicts[1].seq);
    expect(f.deliveryFail).toBeNull();
    expect(recommendByRules(f).decision).toBe("contest");
  });

  it("unlinked facts are empty", () => {
    const f = deriveFacts({ dispute: dispute(REASON_NOT_RECEIVED, "CAP-NONE"), claim: claimFromReason(REASON_NOT_RECEIVED), pack: null });
    expect(f).toMatchObject({ linked: false, chainOk: null, validSeqs: [], capture: null });
  });
});
