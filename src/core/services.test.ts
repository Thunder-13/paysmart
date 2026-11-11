import { describe, expect, it, vi } from "vitest";
import type { Clause, CompiledSlip, NewSlip, Slip } from "./contracts";
import type { GuardVerdictData } from "./events";
import { money } from "./money";
import { normalizeCompiledSlip } from "./services";
import { BUDGET_50, coreRuntime, facts, item, newProposal, newSlipInput } from "./test-helpers";

async function signedSlip(rt: ReturnType<typeof coreRuntime>, input: Partial<NewSlip> = {}, intent: "AUTHORIZE" | "CAPTURE" = "AUTHORIZE", payee?: { email?: string }) {
  const slip = rt.core.createSlip(newSlipInput(input));
  const { orderId, approveUrl } = await rt.core.beginSigning(slip.id, { intent, payee, returnPath: "/p/shop?x=1" });
  expect(approveUrl).toContain(`/mock-paypal/approve?token=${orderId}`);
  rt.mockRail.approveOrder(orderId, "buyer@example.com");
  const signed = await rt.core.completeSigning(slip.id);
  return { slip: signed, orderId };
}

function types(rt: ReturnType<typeof coreRuntime>, slipId: string): string[] {
  return rt.store.ledger.list(slipId).map((e) => e.type);
}

describe("compileSlip", () => {
  it("renumbers, keeps one budget_max equal to the budget, and adds expires_at", async () => {
    const rt = coreRuntime();
    const compiled = await rt.core.compileSlip({
      pipeline: "shop",
      intent: "a toy for my nephew, under $40, nothing with batteries",
      principal: { name: "Ada", email: null },
      mock: (): CompiledSlip => ({
        budget: money("40.00"),
        expiresAt: "not a date",
        summary: "A toy under $40 with no batteries.",
        clauses: [
          { id: "x", kind: "exclude_attribute", label: "c1: Nothing that needs batteries", attribute: "power_source", values: ["battery"] },
          { id: "y", kind: "budget_max", label: "Up to $40", amount: money("40.00") },
          { id: "z", kind: "budget_max", label: "dupe", amount: money("90.00") },
        ],
      }),
    });
    expect(compiled.clauses.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    expect(compiled.clauses.filter((c) => c.kind === "budget_max")).toHaveLength(1);
    expect(compiled.clauses[0].label).toBe("Nothing that needs batteries");
    const exp = compiled.clauses[2] as Extract<Clause, { kind: "expires_at" }>;
    expect(exp.kind).toBe("expires_at");
    expect(exp.at).toBe("2026-11-11T12:00:00.000Z");
    expect(compiled.expiresAt).toBe(exp.at);
  });

  it("takes the lower figure when budget and clause disagree, and inserts a missing budget clause", () => {
    const now = new Date("2026-11-08T12:00:00.000Z");
    const lowered = normalizeCompiledSlip(
      { budget: money("50"), expiresAt: "2026-11-09T00:00:00.000Z", summary: "s", clauses: [{ id: "a", kind: "budget_max", label: "Up to $45", amount: money("45") }] },
      now,
    );
    expect(lowered.budget.value).toBe("45.00");
    const inserted = normalizeCompiledSlip(
      { budget: money("20"), expiresAt: "2026-11-09T00:00:00.000Z", summary: "", clauses: [{ id: "a", kind: "quantity_max", label: "", count: 2 }] },
      now,
    );
    expect(inserted.clauses.map((c) => c.kind)).toEqual(["budget_max", "quantity_max", "expires_at"]);
    expect(inserted.clauses[0].label).toBe("Spend no more than $20.00");
    expect(inserted.clauses[1].label).toBe("No more than 2 items");
    expect(inserted.expiresAt).toBe("2026-11-09T00:00:00.000Z");
  });
});

describe("signing", () => {
  it("AUTHORIZE: order, approval, authorization, events and return path", async () => {
    const rt = coreRuntime();
    const { slip, orderId } = await signedSlip(rt);
    expect(slip.status).toBe("active");
    expect(slip.rail.orderId).toBe(orderId);
    expect(slip.rail.authorizationId).toMatch(/^[0-9A-Z]{17}$/);
    expect(slip.meta.returnPath).toBe("/p/shop?x=1");
    expect(types(rt, slip.id)).toEqual(["slip.created", "rail.order_created", "slip.signing_started", "rail.authorized", "slip.signed"]);
    const order = rt.mockRail.inspectOrder(orderId)!;
    expect(order.returnUrl).toBe(`http://localhost:3000/api/paypal/return?slipId=${slip.id}`);
    expect(order.customId).toBe(slip.id);
    // completeSigning is idempotent
    await rt.core.completeSigning(slip.id);
    expect(types(rt, slip.id).filter((t) => t === "slip.signed")).toHaveLength(1);
  });

  it("refuses to complete before the buyer approves", async () => {
    const rt = coreRuntime();
    const slip = rt.core.createSlip(newSlipInput());
    await rt.core.beginSigning(slip.id, { intent: "AUTHORIZE", returnPath: "/" });
    await expect(rt.core.completeSigning(slip.id)).rejects.toThrow(/not APPROVED/);
  });

  it("CAPTURE: captures the order to a payee and settles", async () => {
    const rt = coreRuntime();
    const { slip } = await signedSlip(rt, { pipeline: "second-look", budget: money("25.00"), clauses: [{ ...BUDGET_50, amount: money("25") }] }, "CAPTURE", {
      email: "seller@example.com",
    });
    expect(slip.status).toBe("settled");
    expect(slip.spent).toEqual(money("25.00"));
    expect(slip.rail.captureIds).toHaveLength(1);
    expect(rt.mockRail.inspectOrder(slip.rail.orderId!)?.payee).toEqual({ email: "seller@example.com" });
    const signed = rt.store.ledger.list(slip.id).find((e) => e.type === "slip.signed")!;
    expect(signed.data).toEqual({ orderId: slip.rail.orderId, authorizationId: null, captureId: slip.rail.captureIds[0] });
  });
});

describe("settlePurchase and releaseRemainder", () => {
  it("captures within the slip, then voids the rest", async () => {
    const rt = coreRuntime();
    const { slip } = await signedSlip(rt);
    const spy = vi.spyOn(rt.rail, "captureAuthorization");
    const res = await rt.core.settlePurchase(slip.id, newProposal({ slipId: slip.id, amount: money("30.00") }), { finalCapture: false });
    expect(res.verdict.decision).toBe("within");
    expect(res.captureId).toBeTruthy();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toMatchObject({ amount: money("30.00"), finalCapture: false });
    let after = rt.store.slips.get(slip.id)!;
    expect(after.spent).toEqual(money("30.00"));
    expect(after.status).toBe("active");

    // Over the remaining $20: outside, no capture.
    const over = await rt.core.settlePurchase(slip.id, newProposal({ slipId: slip.id, amount: money("25.00") }), { finalCapture: false });
    expect(over.verdict.decision).toBe("outside");
    expect(over.captureId).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);

    await rt.core.releaseRemainder(slip.id);
    await rt.core.releaseRemainder(slip.id);
    after = rt.store.slips.get(slip.id)!;
    expect(after.status).toBe("released");
    expect(rt.mockRail.inspectAuthorization(after.rail.authorizationId!)?.status).toBe("VOIDED");
    expect(types(rt, slip.id).filter((t) => t === "rail.voided")).toHaveLength(1);
    const verdicts = rt.store.ledger.list(slip.id).filter((e) => e.type === "guard.verdict");
    expect(verdicts).toHaveLength(2);
    expect((verdicts[0].data as GuardVerdictData).proposal.id).toMatch(/^prop_/);
  });

  it("final capture settles the slip and makes release a silent no-op", async () => {
    const rt = coreRuntime();
    const { slip } = await signedSlip(rt);
    await rt.core.settlePurchase(slip.id, newProposal({ slipId: slip.id, amount: money("42.18") }), { finalCapture: true });
    expect(rt.store.slips.get(slip.id)!.status).toBe("settled");
    const before = types(rt, slip.id).length;
    await expect(rt.core.releaseRemainder(slip.id)).resolves.toBeUndefined();
    expect(types(rt, slip.id).length).toBe(before);
    await expect(rt.core.settlePurchase(slip.id, newProposal({ slipId: slip.id, amount: money("1") }), { finalCapture: true })).rejects.toThrow(/nothing can be captured/);
  });

  it("does not capture when the guard says outside for an injected listing", async () => {
    const rt = coreRuntime();
    const { slip } = await signedSlip(rt);
    const res = await rt.core.settlePurchase(
      slip.id,
      newProposal({ slipId: slip.id, items: [item({ facts: facts({ injectionSuspected: true }) })] }),
      { finalCapture: true },
    );
    expect(res.verdict.violations[0].clauseId).toBe("integrity");
    expect(rt.mockRail.calls().filter((c) => c.method === "captureAuthorization")).toHaveLength(0);
  });

  it("restores the status when PayPal rejects the capture", async () => {
    const rt = coreRuntime();
    const { slip } = await signedSlip(rt);
    vi.spyOn(rt.rail, "captureAuthorization").mockRejectedValueOnce(new Error("PayPal UNPROCESSABLE_ENTITY (debug_id x)"));
    await expect(rt.core.settlePurchase(slip.id, newProposal({ slipId: slip.id }), { finalCapture: false })).rejects.toThrow(/debug_id/);
    expect(rt.store.slips.get(slip.id)!.status).toBe("active");
  });

  it("releases a slip with no authorization without calling PayPal", async () => {
    const rt = coreRuntime();
    const slip = rt.core.createSlip(newSlipInput());
    await rt.core.releaseRemainder(slip.id);
    expect(rt.store.slips.get(slip.id)!.status).toBe("released");
    expect(rt.mockRail.calls()).toHaveLength(0);
    const n = types(rt, slip.id).length;
    await rt.core.releaseRemainder(slip.id);
    expect(types(rt, slip.id).length).toBe(n);
  });
});

describe("child slips", () => {
  it("carves helper budgets from the parent and rejects over-budget helpers", async () => {
    const rt = coreRuntime();
    const { slip: parent } = await signedSlip(rt);
    const childInput = { intent: "assemble the train set", clauses: [] as Clause[], budget: money("15.00"), principal: parent.principal, expiresAt: parent.expiresAt };
    const first = rt.core.createChildSlip(parent.id, childInput);
    expect(first.verdict.decision).toBe("within");
    expect(first.child?.status).toBe("active");
    expect(first.child?.parentId).toBe(parent.id);
    expect(first.child?.clauses.some((c) => c.kind === "budget_max")).toBe(true);
    expect(types(rt, parent.id)).toContain("child.created");
    expect(types(rt, first.child!.id)).toEqual(["slip.created", "child.created"]);

    // $50 budget - $15 child = $35 left; a $40 helper does not fit.
    const second = rt.core.createChildSlip(parent.id, { ...childInput, budget: money("40.00") });
    expect(second.verdict.decision).toBe("outside");
    expect(second.child).toBeNull();

    // The open child also blocks a $40 purchase on the parent.
    const buy = rt.core.evaluate(parent.id, newProposal({ slipId: parent.id, amount: money("40.00") }));
    expect(buy.decision).toBe("outside");

    // Pay the helper $12 from the child, release it, and the parent captures its share.
    const paid = await rt.core.settlePayout(first.child!.id, newProposal({ slipId: first.child!.id, kind: "payout", items: [] }), [
      { receiverEmail: "helper@example.com", amount: money("12.00"), note: "Assembly" },
    ]);
    expect(paid.payoutBatchId).toBeTruthy();
    await rt.core.releaseRemainder(first.child!.id);
    expect(rt.store.slips.get(first.child!.id)!.status).toBe("released");
    const res = await rt.core.settlePurchase(parent.id, newProposal({ slipId: parent.id, amount: money("30.00") }), { finalCapture: true });
    expect(res.verdict.decision).toBe("within");
    const captured = rt.mockRail.inspectCapture(res.captureId!)!;
    expect(captured.amount).toEqual(money("42.00"));
    expect(rt.store.slips.get(first.child!.id)!.meta.capturedInParent).toBe(true);
    expect(rt.store.slips.get(parent.id)!.spent).toEqual(money("42.00"));
  });
});

describe("settlePayout", () => {
  const platformSlip = (clauses: Clause[]) => newSlipInput({ pipeline: "bounty", clauses, budget: money("100.00") });

  it("guards every receiver and rejects the whole batch if one fails", async () => {
    const rt = coreRuntime();
    const allow: Clause = { id: "c2", kind: "payee_allowlist", label: "Only the two maintainers", payees: ["a@example.com", "b@example.com"] };
    const slip = rt.core.createSlip(platformSlip([{ ...BUDGET_50, amount: money("100") }, allow]));
    const res = await rt.core.settlePayout(slip.id, newProposal({ slipId: slip.id, kind: "payout", items: [] }), [
      { receiverEmail: "a@example.com", amount: money("10"), note: "thanks" },
      { receiverEmail: "mallory@example.com", amount: money("10"), note: "thanks" },
    ]);
    expect(res.verdict.decision).toBe("outside");
    expect(res.payoutBatchId).toBeNull();
    expect(rt.mockRail.calls().filter((c) => c.method === "createPayout")).toHaveLength(0);
    const verdict = rt.store.ledger.list(slip.id).find((e) => e.type === "guard.verdict")!.data as GuardVerdictData;
    expect(verdict.proposal.amount).toEqual(money("20.00"));
    expect(verdict.proposal.items.map((i) => i.facts.attributes.payee)).toEqual(["a@example.com", "mallory@example.com"]);
  });

  it("pays a platform-funded draft slip with deterministic sender ids and settles at budget", async () => {
    const rt = coreRuntime();
    const slip = rt.core.createSlip(platformSlip([{ ...BUDGET_50, amount: money("100") }]));
    const first = await rt.core.settlePayout(slip.id, newProposal({ slipId: slip.id, kind: "payout", items: [] }), [
      { receiverEmail: "a@example.com", amount: money("60"), note: "share" },
    ]);
    expect(first.verdict.decision).toBe("within");
    let s = rt.store.slips.get(slip.id)!;
    expect(s.status).toBe("active");
    expect(s.spent).toEqual(money("60.00"));
    const call = rt.mockRail.calls().find((c) => c.method === "createPayout")!;
    expect(call.args[0]).toMatchObject({ senderBatchId: `${slip.id}-1`, items: [{ senderItemId: `${slip.id}-1-1` }] });

    await rt.core.settlePayout(slip.id, newProposal({ slipId: slip.id, kind: "payout", items: [] }), [
      { receiverEmail: "b@example.com", amount: money("40"), note: "share" },
    ]);
    s = rt.store.slips.get(slip.id)!;
    expect(s.status).toBe("settled");
    expect(s.rail.payoutBatchIds).toHaveLength(2);
    expect(rt.mockRail.calls().filter((c) => c.method === "createPayout")[1].args[0]).toMatchObject({ senderBatchId: `${slip.id}-2` });
  });

  it("asks when required evidence is missing", async () => {
    const rt = coreRuntime();
    const ev: Clause = { id: "c2", kind: "require_evidence", label: "Photo of the cleaned park", evidence: "before_after_photos", rubric: "litter gone" };
    const slip = rt.core.createSlip(platformSlip([{ ...BUDGET_50, amount: money("100") }, ev]));
    const res = await rt.core.settlePayout(slip.id, newProposal({ slipId: slip.id, kind: "payout", items: [] }), [
      { receiverEmail: "hunter@example.com", amount: money("25"), note: "bounty" },
    ]);
    expect(res.verdict.decision).toBe("ask");
    expect(res.payoutBatchId).toBeNull();
  });
});

describe("refund, evidence and evidence packs", () => {
  it("refunds a capture and records the amount", async () => {
    const rt = coreRuntime();
    const { slip } = await signedSlip(rt);
    const { captureId } = await rt.core.settlePurchase(slip.id, newProposal({ slipId: slip.id, amount: money("30") }), { finalCapture: true });
    await expect(rt.core.refund(slip.id, { captureId: "NOPE", reason: "x" })).rejects.toThrow(/does not belong/);
    const { refundId } = await rt.core.refund(slip.id, { captureId: captureId!, reason: "Arrived broken" });
    const after = rt.store.slips.get(slip.id)!;
    expect(after.status).toBe("refunded");
    expect(after.rail.refundIds).toEqual([refundId]);
    const ev = rt.store.ledger.list(slip.id).find((e) => e.type === "rail.refunded")!;
    expect(ev.data).toEqual({ refundId, captureId, amount: money("30.00"), reason: "Arrived broken" });
  });

  it("builds an evidence pack with a verified chain, verdicts and evidence", async () => {
    const rt = coreRuntime();
    const { slip } = await signedSlip(rt);
    await rt.core.settlePurchase(slip.id, newProposal({ slipId: slip.id, amount: money("30") }), { finalCapture: true });
    rt.core.addEvidence(slip.id, { kind: "tracking", verdict: "pass", detail: "Delivered Nov 10", ref: "1Z999" });
    expect(() => rt.core.addEvidence(slip.id, { kind: "nope" } as never)).toThrow();
    const pack = await rt.core.evidencePack(slip.id);
    expect(pack.chain).toEqual({ ok: true, brokenAtSeq: null });
    expect(pack.verdicts).toHaveLength(1);
    expect(pack.verdicts[0].decision).toBe("within");
    expect(pack.evidence).toEqual([{ kind: "tracking", verdict: "pass", detail: "Delivered Nov 10", ref: "1Z999" }]);
    expect(pack.events.at(-1)?.type).toBe("evidence.added");
    expect(pack.summary).toContain("Signed with PayPal");
    expect(pack.summary).toContain("ledger events verify");
  });
});

describe("guard sees committed spend", () => {
  it("evaluate records exactly one guard.verdict per call", () => {
    const rt = coreRuntime();
    const slip: Slip = rt.core.createSlip(newSlipInput());
    rt.core.evaluate(slip.id, newProposal({ slipId: slip.id }));
    expect(types(rt, slip.id)).toEqual(["slip.created", "guard.verdict"]);
  });
});
