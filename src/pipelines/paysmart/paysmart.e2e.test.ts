import { describe, expect, it } from "vitest";
import { money } from "@/core/money";
import { linkDispute } from "@/pipelines/dispute-desk/link";
import { events, paysmartRuntime, railCalls, runToChoose, runToDelivery, state, waitData } from "./test-utils";

describe("paysmart end to end (mock mode, no keys)", () => {
  it("runs the demo ask: two options, pick one, hold and capture $47.17, release $0.00", async () => {
    const rt = paysmartRuntime();
    let run = await runToChoose(rt);
    const d = waitData(run) as { options: { id: string; verdict: { decision: string }; proposal: { amount: unknown }; lines: { title: string }[] }[]; ruledOut: unknown[]; funnel: unknown };
    expect(d.options.map((o) => [o.id, o.verdict.decision, o.proposal.amount, o.lines.map((l) => l.title)])).toEqual([
      ["opt-1", "within", money("47.17"), ["Clockwork Rex Wind-Up Walking Dinosaur, tin edition", "Pop-Up T-Rex Birthday Card"]],
      ["opt-2", "within", money("26.39"), ["Dig-a-Saur Triceratops Fossil Dig Kit", "Pop-Up T-Rex Birthday Card"]],
    ]);
    expect(d.ruledOut).toHaveLength(1);
    expect(d.funnel).toEqual({ found: 11, clean: 11, trusted: 10, withinSlip: 3, inCarts: 3 });
    expect(railCalls(rt)).toHaveLength(0);

    run = await rt.orchestrator.resume(run.id, { approved: true, optionId: "opt-1", via: "voice" });
    expect(run.step).toBe("complete_signing");
    rt.mockRail.approveOrder(String(waitData(run).orderId), "buyer@example.com");
    run = await rt.orchestrator.resume(run.id, { approved: true, orderId: String(waitData(run).orderId) });
    expect(run.step).toBe("aftercare");
    run = await rt.orchestrator.resume(run.id, { skip: true });
    expect(run.status).toBe("done");
    const s = state(run);
    expect(s.outcome).toBe("paid");
    expect(s.totals).toEqual({ limit: money("60.00"), held: money("47.17"), captured: money("47.17"), released: money("0.00"), refunded: money("0.00") });
    expect(rt.store.ledger.verifyChain(run.slipId!)).toEqual({ ok: true, brokenAtSeq: null });
  });

  it("red team: the hijack and the scam seller are ruled out and $0.00 reaches them", async () => {
    const rt = paysmartRuntime();
    const run = await runToDelivery(rt, { redTeam: true });
    const s = state(run);
    const by = (id: string) => s.products.find((p) => p.listingId === id)!;
    expect(by("rt-dino-mega-bundle").status).toBe("ruled_out");
    expect(by("rt-dino-mega-bundle").screens.find((x) => x.screen === "integrity")?.status).toBe("fail");
    expect(by("ps-market-trex").status).toBe("ruled_out");
    expect(by("ps-market-trex").screens.find((x) => x.screen === "seller")?.status).toBe("fail");
    const inCarts = s.options.flatMap((o) => o.lines.map((l) => l.listingId));
    expect(inCarts).not.toContain("rt-dino-mega-bundle");
    expect(inCarts).not.toContain("ps-market-trex");
    const captured = railCalls(rt, "captureAuthorization");
    expect(captured).toHaveLength(1);
    expect(captured[0].args[1]).toMatchObject({ amount: money("47.17") });
    expect(railCalls(rt, "createPayout")).toHaveLength(0);
    expect(s.totals?.captured).toEqual(money("47.17"));
  });

  it("a Dispute Desk lookup by capture id finds the PaySmart slip", async () => {
    const rt = paysmartRuntime();
    const run = await runToDelivery(rt);
    const captureId = state(run).captureId!;
    expect(captureId).toBeTruthy();
    const { link } = linkDispute(rt.store, captureId);
    expect(link).toEqual({ method: "capture", slipId: run.slipId });
    expect(rt.store.slips.get(run.slipId!)?.pipeline).toBe("paysmart");
    expect(events(rt, run.slipId, "paysmart.paid")[0].data).toMatchObject({ captureId });
  });
});
