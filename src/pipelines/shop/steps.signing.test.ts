import { describe, expect, it, vi } from "vitest";
import type { Clause, Slip } from "@/core/contracts";
import { money } from "@/core/money";
import { events, shopRuntime, state, waitData } from "./test-utils";

describe("compile, confirm and sign", () => {
  it("waits on the demo slip with six clauses", async () => {
    const rt = shopRuntime();
    const run = await rt.orchestrator.start("shop", {});
    expect(run.status).toBe("waiting");
    expect(run.step).toBe("confirm_slip");
    expect(run.wait?.kind).toBe("user_confirm");
    const clauses = waitData(run).clauses as Clause[];
    expect(clauses.map((c) => c.id)).toEqual(["c1", "c2", "c3", "c4", "c5", "c6"]);
    expect(rt.store.slips.get(run.slipId!)?.status).toBe("draft");
    expect(rt.mockRail.calls()).toHaveLength(0);
  });

  it("applies a lowered budget, records the edit, and holds $50.00", async () => {
    const rt = shopRuntime();
    let run = await rt.orchestrator.start("shop", {});
    const slip = rt.store.slips.get(run.slipId!) as Slip;
    const edited = slip.clauses.map((c) => (c.kind === "budget_max" ? { ...c, amount: money("50.00") } : c));
    run = await rt.orchestrator.resume(run.id, { approved: true, clauses: edited });
    expect(run.step).toBe("complete_signing");
    expect(run.wait?.kind).toBe("paypal_approval");
    const edits = events(rt, run.slipId, "shop.clauses_edited");
    expect(edits).toHaveLength(1);
    expect(edits[0].actor).toBe("user");
    const order = rt.mockRail.inspectOrder(String(waitData(run).orderId));
    expect(order?.amount).toEqual(money("50.00"));
    expect(order?.intent).toBe("AUTHORIZE");
  });

  it("re-asks on an invalid edit without changing the slip", async () => {
    const rt = shopRuntime();
    let run = await rt.orchestrator.start("shop", {});
    const before = rt.store.slips.get(run.slipId!) as Slip;
    run = await rt.orchestrator.resume(run.id, { approved: true, clauses: [...before.clauses, { id: "c9", kind: "budget_max", label: "x", amount: money("5.00") }] });
    expect(run.step).toBe("confirm_slip");
    expect(String(run.wait?.message)).toMatch(/exactly one spending limit/);
    expect(rt.store.slips.get(run.slipId!)?.clauses).toEqual(before.clauses);
  });

  it("finishes cancelled with no PayPal order when the slip is torn up", async () => {
    const rt = shopRuntime();
    let run = await rt.orchestrator.start("shop", {});
    run = await rt.orchestrator.resume(run.id, { approved: false });
    expect(run.status).toBe("done");
    expect(state(run).outcome).toBe("cancelled");
    expect(rt.store.slips.get(run.slipId!)?.status).toBe("rejected");
    expect(rt.mockRail.calls()).toHaveLength(0);
  });

  it("refuses to sign a slip without a spending limit", async () => {
    const rt = shopRuntime();
    let run = await rt.orchestrator.start("shop", { intent: "A dinosaur toy for Leo" });
    expect(String(run.wait?.message)).toMatch(/spending limit/);
    run = await rt.orchestrator.resume(run.id, { approved: true });
    expect(run.step).toBe("confirm_slip");
    expect(rt.mockRail.calls()).toHaveLength(0);
  });

  it("marks the slip rejected and never shops when the buyer cancels at PayPal", async () => {
    const rt = shopRuntime();
    let run = await rt.orchestrator.start("shop", {});
    run = await rt.orchestrator.resume(run.id, { approved: true });
    run = await rt.orchestrator.resume(run.id, { approved: false, orderId: String(waitData(run).orderId) });
    expect(run.status).toBe("done");
    expect(state(run).outcome).toBe("cancelled");
    expect(rt.store.slips.get(run.slipId!)?.status).toBe("rejected");
    expect(events(rt, run.slipId, "shop.search")).toHaveLength(0);
  });

  it("fails the run with the PayPal error when authorization fails", async () => {
    const rt = shopRuntime();
    let run = await rt.orchestrator.start("shop", {});
    run = await rt.orchestrator.resume(run.id, { approved: true });
    const orderId = String(waitData(run).orderId);
    rt.mockRail.approveOrder(orderId, "buyer@example.com");
    vi.spyOn(rt.rail, "authorizeOrder").mockRejectedValue(new Error("INSTRUMENT_DECLINED"));
    run = await rt.orchestrator.resume(run.id, { approved: true, orderId });
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/INSTRUMENT_DECLINED/);
    expect(events(rt, run.slipId, "shop.search")).toHaveLength(0);
    expect(rt.mockRail.calls().some((c) => c.method === "captureAuthorization")).toBe(false);
  });
});
