import { describe, expect, it, vi } from "vitest";
import { money } from "@/core/money";
import { events, NOW, paysmartRuntime, railCalls, runToChoose, runToDelivery, state, waitData } from "./test-utils";

const captures = (rt: ReturnType<typeof paysmartRuntime>) => railCalls(rt, "captureAuthorization");

describe("payment", () => {
  it("option 1: holds, captures and releases per the chosen cart", async () => {
    const rt = paysmartRuntime();
    const run = await runToDelivery(rt);
    expect(run.step).toBe("aftercare");
    expect(waitData(run).stage).toBe("delivery");
    const caps = captures(rt);
    expect(caps).toHaveLength(1);
    expect(caps[0].args[1]).toMatchObject({ amount: money("47.17"), finalCapture: true });
    const auth = events(rt, run.slipId, "rail.authorized")[0].data as { amount: unknown };
    expect(auth.amount).toEqual(money("47.17"));
    expect(state(run).hold).toEqual(money("47.17"));
    expect(state(run).totals).toEqual({ limit: money("60.00"), held: money("47.17"), captured: money("47.17"), released: money("0.00"), refunded: money("0.00") });
    expect(events(rt, run.slipId, "paysmart.hold_sized")[0].data).toMatchObject({ limit: money("60.00"), held: money("47.17") });
  });

  it("option 2: hold and capture are both $26.39, and the choice is recorded as the user's", async () => {
    const rt = paysmartRuntime();
    const run = await runToDelivery(rt, {}, { approved: true, optionId: "opt-2", via: "keyboard" });
    expect(captures(rt)[0].args[1]).toMatchObject({ amount: money("26.39"), finalCapture: true });
    expect(state(run).totals).toMatchObject({ held: money("26.39"), captured: money("26.39"), released: money("0.00") });
    const chosen = events(rt, run.slipId, "paysmart.option_chosen");
    expect(chosen).toHaveLength(1);
    expect(chosen[0].actor).toBe("user");
    expect(chosen[0].data).toMatchObject({ optionId: "opt-2", rank: 2, amount: money("26.39"), via: "keyboard" });
  });

  it("makes no PayPal call until the person has chosen", async () => {
    const rt = paysmartRuntime();
    await runToChoose(rt);
    expect(railCalls(rt)).toHaveLength(0);
  });

  it("a PayPal decline rejects the slip with no capture", async () => {
    const rt = paysmartRuntime();
    let run = await runToChoose(rt);
    run = await rt.orchestrator.resume(run.id, { approved: true });
    rt.mockRail.cancelOrder(String(waitData(run).orderId));
    run = await rt.orchestrator.resume(run.id, { approved: false });
    expect(state(run).outcome).toBe("cancelled");
    expect(captures(rt)).toHaveLength(0);
    expect(rt.store.slips.get(run.slipId!)?.status).toBe("rejected");
  });

  it("a capture error voids the hold and ends capture_failed", async () => {
    const rt = paysmartRuntime();
    vi.spyOn(rt.rail, "captureAuthorization").mockRejectedValue(new Error("AUTHORIZATION_EXPIRED"));
    const run = await runToDelivery(rt);
    expect(run.status).toBe("done");
    expect(state(run).outcome).toBe("capture_failed");
    expect(state(run).note).toMatch(/AUTHORIZATION_EXPIRED/);
    const slip = rt.store.slips.get(run.slipId!)!;
    expect(rt.mockRail.inspectAuthorization(slip.rail.authorizationId!)?.status).toBe("VOIDED");
    expect(events(rt, run.slipId, "paysmart.capture_failed")).toHaveLength(1);
  });

  it("the guard blocks at capture when the slip expired, and voids the hold", async () => {
    let clock = new Date(NOW);
    const rt = paysmartRuntime({ now: () => clock });
    let run = await runToChoose(rt);
    run = await rt.orchestrator.resume(run.id, { approved: true });
    const orderId = String(waitData(run).orderId);
    rt.mockRail.approveOrder(orderId, "buyer@example.com");
    clock = new Date(Date.parse(NOW) + 80 * 3_600_000);
    run = await rt.orchestrator.resume(run.id, { approved: true, orderId });
    expect(state(run).outcome).toBe("blocked");
    expect(state(run).note).toMatch(/c6/);
    expect(captures(rt)).toHaveLength(0);
    const slip = rt.store.slips.get(run.slipId!)!;
    expect(rt.mockRail.inspectAuthorization(slip.rail.authorizationId!)?.status).toBe("VOIDED");
  });

  it("re-shows the PayPal wait on a bad return signal", async () => {
    const rt = paysmartRuntime();
    let run = await runToChoose(rt);
    run = await rt.orchestrator.resume(run.id, { approved: true });
    const orderId = waitData(run).orderId;
    run = await rt.orchestrator.resume(run.id, { nonsense: 1 });
    expect(run.status).toBe("waiting");
    expect(run.step).toBe("complete_signing");
    expect(waitData(run).orderId).toBe(orderId);
  });
});

describe("aftercare", () => {
  it("skip ends paid with an evidence pack", async () => {
    const rt = paysmartRuntime();
    let run = await runToDelivery(rt);
    run = await rt.orchestrator.resume(run.id, { skip: true });
    expect(run.status).toBe("done");
    expect(state(run).outcome).toBe("paid");
    expect(state(run).evidencePack?.chain.ok).toBe(true);
  });

  it("the sample photo breaches the battery clause and refunds the captured amount", async () => {
    const rt = paysmartRuntime();
    let run = await runToDelivery(rt);
    run = await rt.orchestrator.resume(run.id, { sample: true });
    expect(state(run).outcome).toBe("refunded");
    const refunded = events(rt, run.slipId, "rail.refunded").map((e) => (e.data as { amount: unknown }).amount);
    expect(refunded).toEqual([money("47.17")]);
    expect(state(run).totals).toMatchObject({ captured: money("47.17"), refunded: money("47.17") });
    expect(rt.store.ledger.verifyChain(run.slipId!).ok).toBe(true);
  });

  it("re-waits on a bad delivery signal", async () => {
    const rt = paysmartRuntime();
    let run = await runToDelivery(rt);
    run = await rt.orchestrator.resume(run.id, { ref: 12 });
    expect(run.step).toBe("aftercare");
    expect(String(run.wait?.message)).toMatch(/Upload a photo/);
  });
});
