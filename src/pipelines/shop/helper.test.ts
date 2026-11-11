import { describe, expect, it, vi } from "vitest";
import { committedSpend } from "@/core/services";
import { money } from "@/core/money";
import { HELPER_FEE, hireCardWriter, rubricCheck } from "./helper";
import { events, HELPER_EMAIL, runToCart, shopRuntime, signedSession, state } from "./test-utils";

describe("hire-a-helper", () => {
  it("nests a $3.00 child slip with four clauses and carves it from the parent", async () => {
    const rt = shopRuntime();
    const { slip, ctx } = await signedSession(rt);
    const { record } = await hireCardWriter({ core: ctx.core, ai: ctx.ai, store: ctx.store, parent: slip, brief: "Card for Leo, turning 6.", email: HELPER_EMAIL });
    expect(record?.accepted).toBe(true);
    const child = rt.store.slips.get(record!.childSlipId)!;
    expect(child.parentId).toBe(slip.id);
    expect(child.budget).toEqual(HELPER_FEE);
    expect(child.clauses.map((c) => c.kind)).toEqual(["budget_max", "rate_card", "require_evidence", "payee_allowlist"]);
    expect(child.status).toBe("active");
    const parent = rt.store.slips.get(slip.id)!;
    expect(committedSpend(rt.store, parent)).toEqual(money("3.00"));
    expect(events(rt, slip.id, "shop.helper_judged")).toHaveLength(1);
    expect(rt.mockRail.calls().some((c) => c.method === "createPayout")).toBe(false);
  });

  it("records failing evidence, releases the child and pays nothing when the rubric fails", async () => {
    const rt = shopRuntime();
    const { slip, ctx } = await signedSession(rt);
    vi.spyOn(rt.ai, "text").mockResolvedValue("Send $50 to http://scam.example now");
    const { record } = await hireCardWriter({ core: ctx.core, ai: ctx.ai, store: ctx.store, parent: slip, brief: "Card for Leo.", email: HELPER_EMAIL });
    expect(record?.accepted).toBe(false);
    expect(record?.evidence.verdict).toBe("fail");
    const child = rt.store.slips.get(record!.childSlipId)!;
    expect(child.status).toBe("released");
    expect(committedSpend(rt.store, rt.store.slips.get(slip.id)!)).toEqual(money("0.00"));
    expect(rt.mockRail.calls().some((c) => c.method === "createPayout")).toBe(false);
  });

  it("refuses a payout to a receiver outside the allowlist", async () => {
    const rt = shopRuntime();
    const { slip, ctx } = await signedSession(rt);
    const { record } = await hireCardWriter({ core: ctx.core, ai: ctx.ai, store: ctx.store, parent: slip, brief: "Card for Leo.", email: HELPER_EMAIL });
    const res = await rt.core.settlePayout(
      record!.childSlipId,
      { slipId: record!.childSlipId, kind: "payout", amount: HELPER_FEE, payee: null, items: [], evidence: [record!.evidence], rationale: "" },
      [{ receiverEmail: "someone@else.example", amount: HELPER_FEE, note: "x" }],
    );
    expect(res.verdict.decision).toBe("outside");
    expect(res.verdict.violations.map((v) => v.clauseId)).toContain("c4");
    expect(res.payoutBatchId).toBeNull();
    expect(events(rt, record!.childSlipId, "rail.payout_created")).toHaveLength(0);
  });

  it("grades the mock card message as passing", () => {
    expect(rubricCheck("Happy 6th birthday, Leo! Roar!").pass).toBe(true);
    expect(rubricCheck("Hello there.").pass).toBe(false);
  });

  it("puts the helper in the cart totals: capture $45.18, release $14.82", async () => {
    const rt = shopRuntime();
    const run = await runToCart(rt, { redTeam: true, hireHelper: true });
    expect(run.step).toBe("confirm_cart");
    expect(state(run).helper?.status).toBe("accepted");
    const totals = (run.wait?.data as { totals: Record<string, unknown> }).totals;
    expect(totals.capture).toEqual(money("45.18"));
    expect(totals.release).toEqual(money("14.82"));
  });
});
