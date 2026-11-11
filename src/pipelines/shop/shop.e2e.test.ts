import { describe, expect, it } from "vitest";
import { money } from "@/core/money";
import { cited, events, shopRuntime, state, verdicts, waitData } from "./test-utils";

describe("shop end to end (mock mode, no keys)", () => {
  it("runs the hero flow with red-team on and lands the demo numbers", async () => {
    const rt = shopRuntime();
    let run = await rt.orchestrator.start("shop", { redTeam: true });
    expect(run.step).toBe("confirm_slip");
    run = await rt.orchestrator.resume(run.id, { approved: true });
    expect(run.wait?.kind).toBe("paypal_approval");
    const orderId = String(waitData(run).orderId);
    rt.mockRail.approveOrder(orderId, "buyer@example.com");
    run = await rt.orchestrator.resume(run.id, { approved: true, orderId });
    expect(run.step).toBe("confirm_cart");
    run = await rt.orchestrator.resume(run.id, { approved: true, via: "voice" });
    expect(run.step).toBe("verify_delivery");
    run = await rt.orchestrator.resume(run.id, { sample: true });
    expect(run.status).toBe("done");

    const slipId = run.slipId!;
    const vs = verdicts(rt, slipId);
    expect(vs[0].decision).toBe("outside");
    expect(cited(vs[0])).toEqual(expect.arrayContaining(["c2", "integrity"]));
    expect(vs.some((v) => v.decision === "within")).toBe(true);

    const authorized = events(rt, slipId, "rail.authorized")[0].data as { amount: unknown };
    expect(authorized.amount).toEqual(money("60.00"));
    const captured = events(rt, slipId, "rail.captured").map((e) => (e.data as { amount: unknown }).amount);
    expect(captured).toEqual([money("42.18")]);
    const refunded = events(rt, slipId, "rail.refunded").map((e) => (e.data as { amount: unknown }).amount);
    expect(refunded).toEqual([money("42.18")]);

    const s = state(run);
    expect(s.outcome).toBe("refunded");
    expect(s.totals).toEqual({ held: money("60.00"), captured: money("42.18"), released: money("17.82"), refunded: money("42.18") });
    expect(rt.store.ledger.verifyChain(slipId)).toEqual({ ok: true, brokenAtSeq: null });
  });

  it("runs the helper variant: nested child slip settled, $45.18 captured", async () => {
    const rt = shopRuntime();
    let run = await rt.orchestrator.start("shop", { redTeam: true, hireHelper: true });
    run = await rt.orchestrator.resume(run.id, { approved: true });
    const orderId = String(waitData(run).orderId);
    rt.mockRail.approveOrder(orderId, "buyer@example.com");
    run = await rt.orchestrator.resume(run.id, { approved: true, orderId });
    run = await rt.orchestrator.resume(run.id, { approved: true });
    run = await rt.orchestrator.resume(run.id, { sample: true });
    expect(run.status).toBe("done");
    const s = state(run);
    expect(s.totals).toEqual({ held: money("60.00"), captured: money("45.18"), released: money("14.82"), refunded: money("42.18") });
    const children = rt.store.slips.list({ parentId: run.slipId! });
    expect(children).toHaveLength(1);
    expect(children[0].status).toBe("settled");
    expect(rt.store.ledger.verifyChain(children[0].id).ok).toBe(true);
    expect(s.evidencePack?.children.map((c) => c.id)).toEqual([children[0].id]);
  });
});
