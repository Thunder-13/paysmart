import { describe, expect, it, vi } from "vitest";
import { money } from "@/core/money";
import { PayPalError } from "@/core/rail/errors";
import { tamperEvent } from "@/core/testing";
import { fromBase64, sha256Hex } from "./documents";
import { brokenChainLine } from "./draft";
import { seedDemoDisputes, type DemoScenario } from "./seed";
import { casesOf, loadPinnedPack } from "./steps";
import { deskRuntime, notAsDescribedHistory, notReceivedHistory, resumeDesk, startDesk, type DeskTestRuntime } from "./testkit";
import type { ConfirmWaitData } from "./types";

async function seedOne(rt: DeskTestRuntime, captureId: string, scenario: DemoScenario) {
  const res = await seedDemoDisputes(rt, [{ captureId, scenario }]);
  return res.created[0];
}

async function scenarioA(rt = deskRuntime()) {
  const p = await notReceivedHistory(rt);
  const d = await seedOne(rt, p.captureId, "not_received");
  const run = await startDesk(rt, d.id);
  return { rt, ...p, dispute: d, run };
}

function railCalls(rt: DeskTestRuntime, method: string) {
  return rt.mockRail.calls().filter((c) => c.method === method);
}

function typesOf(rt: DeskTestRuntime, slipId: string) {
  return rt.store.ledger.list(slipId).map((e) => e.type);
}

describe("load and link", () => {
  it("getDispute error fails the run with no ledger writes", async () => {
    const rt = deskRuntime();
    const run = await startDesk(rt, "PP-D-NOPE");
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/PayPal couldn't load dispute PP-D-NOPE/);
    expect(run.error).toMatch(/RESOURCE_NOT_FOUND/);
    expect(rt.store.ledger.listRecent(10)).toEqual([]);
    expect(railCalls(rt, "provideEvidence")).toEqual([]);
    expect(railCalls(rt, "acceptClaim")).toEqual([]);
  });

  it("empty dispute id is rejected before any step", async () => {
    const rt = deskRuntime();
    await expect(rt.orchestrator.start("dispute-desk", { disputeId: "" })).rejects.toThrow(/Invalid input/);
  });

  it("linked run carries the slip id and a pinned pack ref", async () => {
    const { rt, run, slipId, captureId } = await scenarioA();
    expect(run.slipId).toBe(slipId);
    expect(run.state.link).toEqual({ method: "capture", slipId });
    const pinned = loadPinnedPack(rt.store, run.state.pack!.ref);
    expect(pinned.slip.id).toBe(slipId);
    expect(run.state.pack).toMatchObject({ chainOk: true, brokenAtSeq: null, eventCount: pinned.events.length });
    expect(run.state.dispute?.transactionId).toBe(captureId);
  });
});

describe("triage and draft", () => {
  it("run waits for user_confirm with recommendation, notes and document sizes", async () => {
    const { run } = await scenarioA();
    expect(run.status).toBe("waiting");
    expect(run.step).toBe("act");
    expect(run.wait?.kind).toBe("user_confirm");
    const data = run.wait!.data as ConfirmWaitData;
    expect(data.suggestedDecision).toBe("contest");
    expect(data.recommendation.decision).toBe("contest");
    expect(data.notes).toBe(run.state.draft!.notes);
    expect(data.notes.length).toBeLessThanOrEqual(2000);
    expect(data.documents).toHaveLength(2);
    for (const doc of data.documents) {
      expect(doc.bytes).toBeGreaterThan(100);
      expect(doc.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(doc).not.toHaveProperty("ref");
    }
    expect(data.confirmLabel).toBe("Send evidence to PayPal");
    expect(data.evidenceType).toBe("PROOF_OF_FULFILLMENT");
  });

  it("linked slip gains a dispute-desk.recommended event", async () => {
    const { rt, run, slipId } = await scenarioA();
    const ev = rt.store.ledger.list(slipId).find((e) => e.type === "dispute-desk.recommended");
    expect(ev?.actor).toBe("agent");
    expect(ev?.data).toMatchObject({ disputeId: run.state.disputeId, decision: "contest", citedSeqs: run.state.recommendation!.citedSeqs });
    expect(rt.store.ledger.verifyChain(slipId)).toEqual({ ok: true, brokenAtSeq: null });
    expect(casesOf(rt.store).get(run.state.disputeId)).toMatchObject({ runId: run.id, decision: "contest", slipId, linkMethod: "capture" });
  });
});

describe("mock-mode scenarios", () => {
  it("scenario not_received recommends contest citing capture and tracking", async () => {
    const { rt, run, slipId } = await scenarioA();
    const events = rt.store.ledger.list(slipId);
    const captureSeq = events.find((e) => e.type === "rail.captured")!.seq;
    const trackingSeq = events.find((e) => e.type === "evidence.added")!.seq;
    const rec = run.state.recommendation!;
    expect(rec.decision).toBe("contest");
    expect(rec.citedSeqs).toEqual(expect.arrayContaining([captureSeq, trackingSeq]));
    expect(rec.alreadyRefunded).toBeNull();
  });

  it("scenario not_as_described recommends accept with already refunded", async () => {
    const rt = deskRuntime();
    const p = await notAsDescribedHistory(rt);
    const d = await seedOne(rt, p.captureId, "not_as_described");
    const run = await startDesk(rt, d.id);
    const rec = run.state.recommendation!;
    const refundSeq = rt.store.ledger.list(p.slipId).find((e) => e.type === "rail.refunded")!.seq;
    expect(rec.decision).toBe("accept");
    expect(rec.citedClauseIds).toEqual(["c2"]);
    expect(rec.alreadyRefunded).toEqual({ amount: money("48.00"), seq: refundSeq, refundId: expect.any(String) });
    const data = run.wait!.data as ConfirmWaitData;
    expect(data.suggestedDecision).toBe("accept");
    expect(data.evidenceType).toBe("PROOF_OF_REFUND");
  });

  it("scenario unlinked recommends need_more", async () => {
    const rt = deskRuntime();
    const d = await seedOne(rt, "CAP-NOBODY-1", "unlinked");
    const run = await startDesk(rt, d.id);
    expect(run.slipId).toBeNull();
    expect(run.state.link).toEqual({ method: "none", slipId: null });
    expect(run.state.recommendation).toMatchObject({ decision: "need_more", citedSeqs: [] });
    expect(run.state.draft?.documents).toEqual([]);
    expect(run.state.draft?.notes).toContain("A tracking number or proof of delivery");
    expect((run.wait!.data as ConfirmWaitData).suggestedDecision).toBe("hold");
  });
});

describe("act", () => {
  it("provideEvidence payload shape", async () => {
    const { rt, run, slipId } = await scenarioA();
    const spy = vi.spyOn(rt.rail, "provideEvidence");
    const notes = run.state.draft!.notes;
    const done = await resumeDesk(rt, run.id, { decision: "contest", notes });
    expect(done.status).toBe("done");
    expect(spy).toHaveBeenCalledTimes(1);
    const [disputeId, input] = spy.mock.calls[0];
    expect(disputeId).toBe(run.state.disputeId);
    expect(input.notes).toBe(notes);
    expect(input.evidenceType).toBe("PROOF_OF_FULFILLMENT");
    expect(input.documents).toHaveLength(2);
    const hashes: string[] = [];
    for (const doc of input.documents!) {
      expect(Object.keys(doc).sort()).toEqual(["base64", "contentType", "name"]);
      expect(["application/json", "text/plain"]).toContain(doc.contentType);
      const decoded = fromBase64(doc.base64);
      if (doc.contentType === "application/json") expect(() => JSON.parse(decoded)).not.toThrow();
      hashes.push(sha256Hex(Buffer.from(doc.base64, "base64")));
    }
    const evs = rt.store.ledger.list(slipId).filter((e) => e.type === "rail.dispute_evidence");
    expect(evs).toHaveLength(1);
    expect(evs[0].actor).toBe("rail");
    const data = evs[0].data as { disputeId: string; status: string; documentHashes: { sha256: string }[] };
    expect(data.disputeId).toBe(run.state.disputeId);
    expect(data.status).toBe("UNDER_REVIEW");
    expect(data.documentHashes.map((h) => h.sha256).sort()).toEqual(hashes.sort());
    expect(done.state.outcome).toMatchObject({ kind: "evidence_sent", paypalStatus: "UNDER_REVIEW", ledgerSeq: evs[0].seq });
    expect(casesOf(rt.store).get(run.state.disputeId)).toMatchObject({ outcome: "evidence_sent", paypalStatus: "UNDER_REVIEW" });
  });

  it("acceptClaim path", async () => {
    const { rt, run, slipId } = await scenarioA();
    const accept = vi.spyOn(rt.rail, "acceptClaim");
    const provide = vi.spyOn(rt.rail, "provideEvidence");
    const done = await resumeDesk(rt, run.id, { decision: "accept", notes: "We'll take this one." });
    expect(accept).toHaveBeenCalledWith(run.state.disputeId, "We'll take this one.");
    expect(accept).toHaveBeenCalledTimes(1);
    expect(provide).not.toHaveBeenCalled();
    expect(typesOf(rt, slipId).filter((t) => t === "rail.dispute_accepted")).toHaveLength(1);
    expect(done.state.outcome).toMatchObject({ kind: "claim_accepted", paypalStatus: "RESOLVED" });
  });

  it("WaitPanel {approved: true} sends the suggested decision with the draft notes", async () => {
    const { rt, run } = await scenarioA();
    const spy = vi.spyOn(rt.rail, "provideEvidence");
    const done = await resumeDesk(rt, run.id, { approved: true });
    expect(spy.mock.calls[0][1].notes).toBe(run.state.draft!.notes);
    expect(done.state.outcome?.kind).toBe("evidence_sent");
  });

  it("invalid signal re-waits without PayPal calls", async () => {
    const { rt, run } = await scenarioA();
    const again = await resumeDesk(rt, run.id, { decision: "contest", notes: "" });
    expect(again.status).toBe("waiting");
    expect(again.step).toBe("act");
    expect(again.state.confirmError).toMatch(/Write a response/);
    expect((again.wait!.data as ConfirmWaitData).error).toMatch(/Write a response/);
    expect(railCalls(rt, "provideEvidence")).toEqual([]);
    expect(railCalls(rt, "acceptClaim")).toEqual([]);
    const ok = await resumeDesk(rt, run.id, { decision: "contest", notes: "Tracking shows delivery." });
    expect(ok.state.outcome?.kind).toBe("evidence_sent");
  });

  it("hold finishes with outcome held and no PayPal writes", async () => {
    const { rt, run } = await scenarioA();
    const done = await resumeDesk(rt, run.id, { decision: "hold", notes: "" });
    expect(done.status).toBe("done");
    expect(done.state.outcome).toMatchObject({ kind: "held", paypalStatus: null });
    expect(railCalls(rt, "provideEvidence")).toEqual([]);
    expect(railCalls(rt, "acceptClaim")).toEqual([]);
  });

  it("status UNDER_REVIEW at act time ends not_actionable", async () => {
    const { rt, run, dispute } = await scenarioA();
    rt.mockRail.seedDisputes([{ ...dispute, status: "UNDER_REVIEW" }]);
    const done = await resumeDesk(rt, run.id, { decision: "contest", notes: "Tracking shows delivery." });
    expect(done.state.outcome).toMatchObject({ kind: "not_actionable", paypalStatus: "UNDER_REVIEW" });
    expect(railCalls(rt, "provideEvidence")).toEqual([]);
  });

  it("provideEvidence error re-waits with the error and appends no ledger event", async () => {
    const { rt, run, slipId } = await scenarioA();
    vi.spyOn(rt.rail, "provideEvidence").mockRejectedValueOnce(
      new PayPalError({ name: "UNPROCESSABLE_ENTITY", message: "Invalid evidence file type.", status: 422, debug_id: "dbg1", details: [{ issue: "INVALID_EVIDENCE_FILE" }] }),
    );
    const again = await resumeDesk(rt, run.id, { decision: "contest", notes: "Edited notes." });
    expect(again.status).toBe("waiting");
    expect(again.state.confirmError).toMatch(/PayPal didn't accept the evidence: .*INVALID_EVIDENCE_FILE/);
    expect((again.wait!.data as ConfirmWaitData).notes).toBe("Edited notes.");
    expect(typesOf(rt, slipId)).not.toContain("rail.dispute_evidence");
    const ok = await resumeDesk(rt, run.id, { decision: "contest", notes: "Edited notes." });
    expect(ok.state.outcome?.kind).toBe("evidence_sent");
    expect(typesOf(rt, slipId).filter((t) => t === "rail.dispute_evidence")).toHaveLength(1);
  });

  it("broken chain contest sends notes only", async () => {
    const rt = deskRuntime();
    const p = await notReceivedHistory(rt);
    tamperEvent(rt.store, p.slipId, 2);
    const d = await seedOne(rt, p.captureId, "not_received");
    const run = await startDesk(rt, d.id);
    const rec = run.state.recommendation!;
    expect(rec).toMatchObject({ decision: "need_more", citedSeqs: [], citedClauseIds: [] });
    expect(rec.warnings.join(" ")).toContain("#2");
    expect(run.state.draft?.documents).toEqual([]);
    const spy = vi.spyOn(rt.rail, "provideEvidence");
    await resumeDesk(rt, run.id, { decision: "contest", notes: "We disagree." });
    const input = spy.mock.calls[0][1];
    expect(input.documents).toBeUndefined();
    expect(input.notes).toContain(brokenChainLine(2));
    expect(input.notes).toContain("failed verification");
  });

  it("unlinked contest sends notes only and appends no ledger event", async () => {
    const rt = deskRuntime();
    const d = await seedOne(rt, "CAP-NOBODY-2", "unlinked");
    const run = await startDesk(rt, d.id);
    const spy = vi.spyOn(rt.rail, "provideEvidence");
    const done = await resumeDesk(rt, run.id, { decision: "contest", notes: "We shipped it; tracking to follow." });
    expect(spy.mock.calls[0][1]).toEqual({ notes: "We shipped it; tracking to follow.", evidenceType: "OTHER" });
    expect(done.state.outcome).toMatchObject({ kind: "evidence_sent", ledgerSeq: null });
    expect(rt.store.ledger.listRecent(5)).toEqual([]);
  });
});
