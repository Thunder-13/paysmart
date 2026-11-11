import { describe, expect, it } from "vitest";
import { createTestRuntime } from "@/core/testing";
import { DEMO_FAMILY, approveToShipment, fixtureInput, startToApproval, startToSeller, type SLRun } from "./demo-flows";
import { HandoffError, getHandoff, handoffsCollection, recordHandoff } from "./handoff";
import secondLook from "./index";

function rt() {
  return createTestRuntime({ pipelines: { "second-look": secondLook }, seedRail: false });
}

describe("second-look hand-off", () => {
  it("second report returns the same record", async () => {
    const r = rt();
    const shipment = await approveToShipment(r, await startToApproval(r, fixtureInput("legit")));
    const run = r.orchestrator.get(shipment.id) as SLRun;
    const first = recordHandoff(r.store, run, r.now());
    const second = recordHandoff(r.store, run, r.now());
    expect(second).toEqual(first);
    expect(first.id).toBe(run.state.captureId);
    expect(first).toMatchObject({
      captureId: run.state.captureId,
      orderId: run.state.orderId,
      slipId: run.slipId,
      runId: run.id,
      sellerEmail: "priya.lens@example.com",
      amount: { currency: "USD", value: "120.00" },
      reason: "item_not_received",
      status: "open",
    });
    expect(handoffsCollection(r.store).list()).toHaveLength(1);
    expect(getHandoff(r.store, run.id)?.id).toBe(first.id);
    const events = r.store.ledger.list(run.slipId!).filter((e) => e.type === "second-look.handoff_created");
    expect(events).toHaveLength(1);
  });

  it("rejects a run without a capture", async () => {
    const r = rt();
    const seller = await startToSeller(r, fixtureInput("scam", { trustedContactEmail: DEMO_FAMILY }));
    const refused = (await r.orchestrator.resume(seller.id, { response: "refused" })) as SLRun;
    expect(refused.state.outcome).toBe("seller_refused");
    expect(() => recordHandoff(r.store, refused, r.now())).toThrow(HandoffError);
    expect(handoffsCollection(r.store).list()).toEqual([]);
  });
});
