import { describe, expect, it } from "vitest";
import { MINUTE, makeKit, railMethods } from "./testkit";
import { fundedTotal } from "./records";

describe("pledge run", () => {
  it("approved pledge holds money without capturing it", async () => {
    const kit = makeKit();
    const { bounty } = await kit.createBounty();
    const { run, slipId } = await kit.pledge(bounty.id, "Ann Lee", "25.00");
    expect(run.status).toBe("done");
    expect(run.state.outcome).toBe("held");
    const slip = kit.rt.store.slips.get(slipId!)!;
    expect(slip.status).toBe("active");
    expect(slip.rail.authorizationId).toBeTruthy();
    expect(slip.rail.captureIds).toEqual([]);
    expect(slip.meta.bountyId).toBe(bounty.id);
    expect(slip.clauses.map((c) => c.kind)).toEqual(["budget_max", "require_evidence", "expires_at"]);
    expect(fundedTotal(kit.rt.store, bounty).value).toBe("25.00");
    expect(railMethods(kit)).not.toContain("captureAuthorization");
    const types = kit.rt.store.ledger.list(bounty.payoutSlipId).map((e) => e.type);
    expect(types).toContain("bounty.pledged");
  });

  it("reduces a pledge to the uncovered remainder", async () => {
    const kit = makeKit();
    const { bounty } = await kit.createBounty();
    await kit.pledge(bounty.id, "Ann Lee", "30.00");
    const { start, slipId } = await kit.pledge(bounty.id, "Bo Chen", "25.00");
    const slip = kit.rt.store.slips.get(slipId!)!;
    expect(slip.budget.value).toBe("10.00");
    const order = kit.rt.mockRail.inspectOrder(slip.rail.orderId!)!;
    expect(order.amount.value).toBe("10.00");
    expect((start.wait?.data as { amount: { value: string } }).amount.value).toBe("10.00");
  });

  it("refuses a pledge to a covered bounty without creating a slip or order", async () => {
    const kit = makeKit();
    const { bounty } = await kit.createBounty();
    await kit.pledge(bounty.id, "Ann Lee", "40.00");
    const before = kit.rt.store.slips.list().length;
    const orders = railMethods(kit).filter((m) => m === "createOrder").length;
    const { run } = await kit.pledge(bounty.id, "Late Larry", "5.00");
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/not taking pledges/);
    expect(kit.rt.store.slips.list().length).toBe(before);
    expect(railMethods(kit).filter((m) => m === "createOrder").length).toBe(orders);
  });

  it("refuses a pledge to an expired bounty", async () => {
    const kit = makeKit();
    const { bounty } = await kit.createBounty();
    kit.clock.advance(49 * 60 * MINUTE);
    await kit.nudge(bounty.id, { event: "tick" });
    const { run } = await kit.pledge(bounty.id, "Ann Lee", "10.00");
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/expired/);
  });

  it("leaves the slip rejected and funding unchanged when the backer cancels at PayPal", async () => {
    const kit = makeKit();
    const { bounty } = await kit.createBounty();
    const { run, slipId } = await kit.pledge(bounty.id, "Ann Lee", "25.00", { approve: false });
    expect(run.state.outcome).toBe("declined");
    expect(kit.rt.store.slips.get(slipId!)!.status).toBe("rejected");
    expect(fundedTotal(kit.rt.store, bounty).value).toBe("0.00");
  });

  it("voids a pledge approved after the bounty was cancelled", async () => {
    const kit = makeKit();
    const { bounty } = await kit.createBounty();
    const start = await kit.rt.orchestrator.start("bounty", {
      kind: "pledge",
      bountyId: bounty.id,
      backer: { name: "Slow Sam", email: "sam@example.com" },
      amount: { currency: "USD", value: "20.00" },
    });
    await kit.nudge(bounty.id, { event: "cancel" });
    expect(kit.bounty(bounty.id).status).toBe("cancelled");
    const orderId = (start.wait?.data as { orderId: string }).orderId;
    kit.rt.mockRail.approveOrder(orderId, "sam@example.com");
    const done = await kit.rt.orchestrator.resume(start.id, { approved: true, orderId });
    expect(done.state).toMatchObject({ outcome: "voided_late" });
    const slip = kit.rt.store.slips.get(start.slipId!)!;
    expect(slip.status).toBe("released");
    const pledgeEvents = kit.rt.store.ledger.list(slip.id).map((e) => e.type);
    expect(pledgeEvents).toContain("rail.authorized");
    expect(pledgeEvents).toContain("rail.voided");
    expect(railMethods(kit)).not.toContain("captureAuthorization");
  });
});
