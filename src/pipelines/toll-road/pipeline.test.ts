import { describe, expect, it, vi } from "vitest";
import type { Slip } from "@/core/contracts";
import { PayPalError } from "@/core/rail/errors";
import { sumMoney } from "@/core/money";
import { metersForSlip } from "./metering";
import { BUYER, clockedRuntime, railCalls, runThrough, stateOf, type TestRt } from "./test-helpers";

function slipOf(rt: TestRt, id: string | null): Slip {
  const slip = id ? rt.store.slips.get(id) : null;
  if (!slip) throw new Error(`no slip ${id}`);
  return slip;
}

describe("toll-road pipeline", () => {
  it("run waits on user_confirm, then paypal_approval, then the slip is active", async () => {
    const { rt } = clockedRuntime();
    const started = await rt.orchestrator.start("toll-road", {});
    expect(started.status).toBe("waiting");
    expect(started.wait?.kind).toBe("user_confirm");
    const draft = slipOf(rt, started.slipId);
    expect(draft.status).toBe("draft");
    expect(draft.clauses.map((c) => c.kind)).toEqual(["budget_max", "rate_card", "expires_at"]);
    expect(draft.budget.value).toBe("0.15");

    const signing = await rt.orchestrator.resume(started.id, { approved: true });
    expect(signing.status).toBe("waiting");
    expect(signing.wait?.kind).toBe("paypal_approval");
    expect(signing.step).toBe("activate");
    const orderId = stateOf(signing).orderId!;
    expect(rt.mockRail.inspectOrder(orderId)?.intent).toBe("AUTHORIZE");
    expect(slipOf(rt, started.slipId).status).toBe("awaiting_signature");

    rt.mockRail.approveOrder(orderId, BUYER);
    await rt.orchestrator.resume(started.id, { approved: true, orderId });
    const types = rt.store.ledger.list(started.slipId!).map((e) => e.type);
    expect(types).toContain("slip.signed");
    expect(types.indexOf("slip.signed")).toBeLessThan(types.indexOf("toll-road.metered"));
  });

  it("confirmed false ends declined with slip rejected and no order", async () => {
    const { rt } = clockedRuntime();
    const started = await rt.orchestrator.start("toll-road", {});
    const done = await rt.orchestrator.resume(started.id, { approved: false });
    expect(done.status).toBe("done");
    expect(stateOf(done).outcome).toBe("declined");
    expect(slipOf(rt, started.slipId).status).toBe("rejected");
    expect(railCalls(rt, "createOrder")).toHaveLength(0);
  });

  it("approved false ends not_signed with slip rejected", async () => {
    const { rt } = clockedRuntime();
    const started = await rt.orchestrator.start("toll-road", {});
    const signing = await rt.orchestrator.resume(started.id, { confirmed: true });
    rt.mockRail.cancelOrder(stateOf(signing).orderId!);
    const done = await rt.orchestrator.resume(started.id, { approved: false, orderId: stateOf(signing).orderId });
    expect(stateOf(done).outcome).toBe("not_signed");
    expect(slipOf(rt, started.slipId).status).toBe("rejected");
    expect(metersForSlip(rt.store, started.slipId!)).toHaveLength(0);
    expect(railCalls(rt, "authorizeOrder")).toHaveLength(0);
  });

  it("mock crawl pays 4, refuses 2, stops on budget_exhausted and asks for a new slip", async () => {
    const { rt } = clockedRuntime();
    const run = await runThrough(rt);
    const s = stateOf(run);
    expect(s.attempts.filter((a) => a.outcome === "paid").map((a) => a.contentId)).toEqual(["tw-1", "qs-1", "lr-1", "tw-2"]);
    expect(s.attempts.filter((a) => a.outcome === "refused").map((a) => [a.contentId, a.reason])).toEqual([
      ["lr-2", "price_above_cap"],
      ["qs-2", "budget_exhausted"],
    ]);
    expect(s.attempts.find((a) => a.contentId === "tw-2")?.injectionSuspected).toBe(true);
    expect(s.stopReason).toBe("budget_exhausted");
    expect(s.needsNewSlip).toBe(true);
    expect(s.citations).toEqual(["tw-1", "qs-1", "lr-1", "tw-2"]);
    expect(s.answer).toContain("boil notice");
  });

  it("settlement capture equals meter total", async () => {
    const { rt } = clockedRuntime();
    const run = await runThrough(rt);
    const toll = slipOf(rt, run.slipId);
    const meters = metersForSlip(rt.store, toll.id);
    const total = sumMoney(meters.map((m) => m.amount));
    expect(total.value).toBe("0.13");

    const captures = railCalls(rt, "captureAuthorization");
    expect(captures).toHaveLength(1);
    expect(captures[0].args[1]).toMatchObject({ amount: { value: "0.13" }, finalCapture: true });
    expect(rt.mockRail.inspectAuthorization(toll.rail.authorizationId!)?.status).toBe("CAPTURED");
    expect(toll.status).toBe("settled");
    expect(toll.spent.value).toBe("0.13");
    expect(meters.every((m) => m.settled && m.captureId === stateOf(run).captureId)).toBe(true);
    const settled = rt.store.ledger.list(toll.id).find((e) => e.type === "toll-road.settled");
    expect(settled?.data).toMatchObject({ captureId: stateOf(run).captureId, total: { value: "0.13" }, fetches: 4 });
  });

  it("payout batch pays $0.04, $0.04 and $0.05 to the three publisher emails", async () => {
    const { rt } = clockedRuntime();
    const run = await runThrough(rt);
    const s = stateOf(run);
    expect(s.outcome).toBe("paid");
    const payouts = railCalls(rt, "createPayout");
    expect(payouts).toHaveLength(1);
    const items = (payouts[0].args[0] as { items: { receiverEmail: string; amount: { value: string } }[] }).items;
    expect(Object.fromEntries(items.map((i) => [i.receiverEmail, i.amount.value]))).toEqual({
      "longridge@example.com": "0.05",
      "quarry@example.com": "0.04",
      "tidewater@example.com": "0.04",
    });
    expect(s.splits.map((x) => x.weightBps)).toEqual([3846, 3077, 3077]);
    const network = slipOf(rt, s.networkSlipId);
    expect(network.principal.name).toBe("Toll Road network");
    expect(network.status).toBe("settled");
    expect(network.rail.payoutBatchIds).toEqual([s.payoutBatchId]);
  });

  it("full mock run", async () => {
    const { rt } = clockedRuntime();
    const run = await runThrough(rt);
    expect(run.status).toBe("done");
    const s = stateOf(run);
    expect(s.outcome).toBe("paid");
    const toll = slipOf(rt, run.slipId);
    const captured = railCalls(rt, "captureAuthorization")[0].args[1] as { amount: { value: string } };
    expect(captured.amount.value).toBe(s.meterTotal?.value);
    const paid = (railCalls(rt, "createPayout")[0].args[0] as { items: { amount: { currency: string; value: string } }[] }).items;
    expect(sumMoney(paid.map((i) => i.amount)).value).toBe(s.meterTotal?.value);
    expect(rt.store.ledger.verifyChain(toll.id)).toEqual({ ok: true, brokenAtSeq: null });
    expect(rt.store.ledger.verifyChain(s.networkSlipId!)).toEqual({ ok: true, brokenAtSeq: null });
    expect(toll.meta.networkSlipId).toBe(s.networkSlipId);
  });

  it("no meters ends nothing_to_settle with the authorization voided and no capture", async () => {
    const { rt } = clockedRuntime();
    const run = await runThrough(rt, { intent: "Spend up to $0.15 on articles, no more than 1 cent per article, for the next hour." });
    const s = stateOf(run);
    expect(run.status).toBe("done");
    expect(s.outcome).toBe("nothing_to_settle");
    expect(s.attempts.every((a) => a.outcome === "refused" && a.reason === "price_above_cap")).toBe(true);
    expect(railCalls(rt, "captureAuthorization")).toHaveLength(0);
    expect(railCalls(rt, "voidAuthorization")).toHaveLength(1);
    expect(slipOf(rt, run.slipId).status).toBe("released");
    expect(railCalls(rt, "createPayout")).toHaveLength(0);
  });

  it("expired slip at settlement voids and fails with no payout", async () => {
    const { rt, clock } = clockedRuntime();
    const original = rt.core.settlePurchase.bind(rt.core);
    vi.spyOn(rt.core, "settlePurchase").mockImplementation(async (...args) => {
      clock.advance(2 * 3_600_000); // the slip ran out while the crawl wrapped up
      return original(...args);
    });
    const run = await runThrough(rt);
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/c3/);
    expect(railCalls(rt, "captureAuthorization")).toHaveLength(0);
    expect(railCalls(rt, "voidAuthorization")).toHaveLength(1);
    expect(slipOf(rt, run.slipId).status).toBe("released");
    expect(metersForSlip(rt.store, run.slipId!).every((m) => !m.settled)).toBe(true);
    expect(railCalls(rt, "createPayout")).toHaveLength(0);
  });

  it("capture error fails with meters unsettled", async () => {
    const { rt } = clockedRuntime();
    vi.spyOn(rt.rail, "captureAuthorization").mockRejectedValue(
      new PayPalError({ name: "UNPROCESSABLE_ENTITY", message: "The requested action could not be performed.", debug_id: "dbg1", status: 422, details: [{ issue: "AUTHORIZATION_EXPIRED" }] }),
    );
    const run = await runThrough(rt);
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/PayPal capture failed/);
    expect(run.error).toMatch(/AUTHORIZATION_EXPIRED/);
    const meters = metersForSlip(rt.store, run.slipId!);
    expect(meters).toHaveLength(4);
    expect(meters.every((m) => !m.settled)).toBe(true);
    expect(railCalls(rt, "createPayout")).toHaveLength(0);
  });
});
