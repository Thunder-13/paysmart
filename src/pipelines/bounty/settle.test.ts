import { describe, expect, it, vi } from "vitest";
import type { Run } from "@/core/contracts";
import { money } from "@/core/money";
import { PayPalError } from "@/core/rail/errors";
import { PASSING_PAIR } from "./fixtures";
import { MINUTE, makeKit, railMethods } from "./testkit";

function paypalError(issue: string): PayPalError {
  return new PayPalError({ name: "UNPROCESSABLE_ENTITY", message: "The requested action could not be performed.", debug_id: "dbg1", status: 422, details: [{ issue }] });
}

describe("settlement", () => {
  it("race for the last 10.00 captures the first and voids the second", async () => {
    const kit = makeKit();
    const { bounty } = await kit.createBounty();
    await kit.pledge(bounty.id, "Ann Lee", "30.00");
    const starts: Run[] = [];
    for (const name of ["Bo Chen", "Cy Park"]) {
      starts.push(
        await kit.rt.orchestrator.start("bounty", {
          kind: "pledge",
          bountyId: bounty.id,
          backer: { name, email: `${name.split(" ")[0].toLowerCase()}@example.com` },
          amount: money("10.00"),
        }),
      );
    }
    for (const run of starts) {
      kit.clock.advance(MINUTE);
      const orderId = (run.wait?.data as { orderId: string }).orderId;
      kit.rt.mockRail.approveOrder(orderId, "backer@example.com");
      await kit.rt.orchestrator.resume(run.id, { approved: true, orderId });
    }
    await kit.nudge(bounty.id, { event: "pledge" });
    expect(kit.bounty(bounty.id).status).toBe("funded");
    await kit.claim(bounty.id);
    await kit.prove(bounty.id, PASSING_PAIR);

    const b = kit.bounty(bounty.id);
    expect(b.status).toBe("paid");
    expect(b.captures.map((c) => [c.backer, c.amount.value])).toEqual([
      ["Ann Lee", "30.00"],
      ["Bo Chen", "10.00"],
    ]);
    const cy = kit.rt.store.slips.get(starts[1].slipId!)!;
    expect(cy.status).toBe("released");
    expect(cy.rail.captureIds).toEqual([]);
    expect(kit.rt.mockRail.inspectAuthorization(cy.rail.authorizationId!)!.status).toBe("VOIDED");
  });

  it("refunds and voids everything when a capture fails", async () => {
    const kit = makeKit();
    const { bountyId, pledgeIds } = await kit.fundedAndClaimed();
    const rail = kit.rt.rail;
    const original = rail.captureAuthorization.bind(rail);
    let n = 0;
    vi.spyOn(rail, "captureAuthorization").mockImplementation(async (...args) => {
      n += 1;
      if (n === 2) throw paypalError("AUTHORIZATION_EXPIRED");
      return original(...args);
    });
    const run = await kit.prove(bountyId, PASSING_PAIR);
    expect(run?.status).toBe("done");
    const b = kit.bounty(bountyId);
    expect(b.status).toBe("settle_failed");
    expect(b.failure).toMatch(/Bo Chen.*AUTHORIZATION_EXPIRED/);
    expect(kit.rt.store.slips.get(pledgeIds[0])!.status).toBe("refunded");
    expect(kit.rt.store.slips.get(pledgeIds[0])!.rail.refundIds).toHaveLength(1);
    const second = kit.rt.store.slips.get(pledgeIds[1])!;
    expect(second.status).toBe("released");
    expect(kit.rt.mockRail.inspectAuthorization(second.rail.authorizationId!)!.status).toBe("VOIDED");
    const payoutSlip = kit.rt.store.slips.get(b.payoutSlipId)!;
    expect(payoutSlip.rail.payoutBatchIds).toEqual([]);
    expect(railMethods(kit)).not.toContain("createPayout");
  });

  it("waits for the organizer when the payout fails, and a retry creates exactly 1 batch", async () => {
    const kit = makeKit();
    const { bountyId } = await kit.fundedAndClaimed();
    vi.spyOn(kit.rt.rail, "createPayout").mockRejectedValueOnce(paypalError("INSUFFICIENT_FUNDS"));
    const run = await kit.prove(bountyId, PASSING_PAIR);
    expect(run?.status).toBe("waiting");
    expect(run?.wait).toMatchObject({ kind: "user_confirm", data: { confirmLabel: "Retry payout", declineLabel: "Refund backers" } });
    expect(kit.bounty(bountyId).status).toBe("payout_failed");
    expect(kit.bounty(bountyId).captures).toHaveLength(2);

    const done = await kit.nudge(bountyId, { approved: true });
    expect(done?.status).toBe("done");
    const b = kit.bounty(bountyId);
    expect(b.status).toBe("paid");
    expect(kit.rt.store.slips.get(b.payoutSlipId)!.rail.payoutBatchIds).toHaveLength(1);
    expect(railMethods(kit).filter((m) => m === "captureAuthorization")).toHaveLength(2);
  });

  it("refunds both backers when the organizer gives up on a failed payout", async () => {
    const kit = makeKit();
    const { bountyId, pledgeIds } = await kit.fundedAndClaimed();
    vi.spyOn(kit.rt.rail, "createPayout").mockRejectedValueOnce(paypalError("RECEIVER_UNREGISTERED"));
    await kit.prove(bountyId, PASSING_PAIR);
    const done = await kit.nudge(bountyId, { event: "payout_refund" });
    expect(done?.status).toBe("done");
    expect(kit.bounty(bountyId).status).toBe("refunded");
    for (const id of pledgeIds) expect(kit.rt.store.slips.get(id)!.status).toBe("refunded");
    expect(kit.rt.store.slips.get(kit.bounty(bountyId).payoutSlipId)!.rail.payoutBatchIds).toEqual([]);
  });
});
