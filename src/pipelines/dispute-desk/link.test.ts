import { describe, expect, it } from "vitest";
import { money } from "@/core/money";
import { linkDispute } from "./link";
import { CLAUSES, deskRuntime, signedPurchase, type DeskTestRuntime } from "./testkit";

function bareSlip(rt: DeskTestRuntime) {
  return rt.core.createSlip({
    pipeline: "second-look",
    principal: { name: "Bo", email: "bo@example.com" },
    intent: "Pay the seller for a used bike",
    clauses: CLAUSES.slice(0, 1),
    budget: money("60.00"),
    expiresAt: "2026-11-13T00:00:00.000Z",
  });
}

function handoff(over: Record<string, unknown>) {
  return {
    captureId: "CAP-H1",
    orderId: "ORDER-H1",
    slipId: null,
    runId: "run_x",
    sellerEmail: "seller@example.com",
    amount: { currency: "USD", value: "120.00" },
    reason: "item_not_received",
    trackingNumber: "9400111899223197428490",
    carrier: "USPS",
    riskScore: 0.82,
    tactics: ["urgency", { id: "off_platform", label: "Moving off-platform" }],
    createdAt: "2026-11-09T10:00:00.000Z",
    status: "open",
    ...over,
  };
}

describe("linkDispute", () => {
  it("links by capture id", async () => {
    const rt = deskRuntime();
    const { slipId, captureId } = await signedPurchase(rt);
    const res = linkDispute(rt.store, captureId);
    expect(res.link).toEqual({ method: "capture", slipId });
    expect(res.handoff).toBeNull();
    expect(res.warnings).toEqual([]);
  });

  it("links through a second-look handoff record keyed by capture id", () => {
    const rt = deskRuntime();
    const slip = bareSlip(rt);
    rt.store.collection("second-look", "handoffs").put("CAP-H1", handoff({ slipId: slip.id }));
    const res = linkDispute(rt.store, "CAP-H1");
    expect(res.link).toEqual({ method: "handoff", slipId: slip.id });
    expect(res.handoff).toMatchObject({ captureId: "CAP-H1", trackingNumber: "9400111899223197428490", carrier: "USPS", tactics: ["urgency", "Moving off-platform"] });
  });

  it("links through a handoff matched on orderId", () => {
    const rt = deskRuntime();
    const slip = bareSlip(rt);
    rt.store.collection("second-look", "handoffs").put("CAP-H1", handoff({ slipId: slip.id }));
    expect(linkDispute(rt.store, "ORDER-H1").link).toEqual({ method: "handoff", slipId: slip.id });
  });

  it("keeps handoff tracking as context when findByRailId already linked", async () => {
    const rt = deskRuntime();
    const { slipId, captureId } = await signedPurchase(rt);
    rt.store.collection("second-look", "handoffs").put(captureId, handoff({ captureId, slipId }));
    const res = linkDispute(rt.store, captureId);
    expect(res.link).toEqual({ method: "capture", slipId });
    expect(res.handoff?.trackingNumber).toBe("9400111899223197428490");
  });

  it("null transaction id links to none", () => {
    const rt = deskRuntime();
    expect(linkDispute(rt.store, null)).toEqual({ link: { method: "none", slipId: null }, handoff: null, warnings: [] });
    expect(linkDispute(rt.store, "CAP-NOBODY").link).toEqual({ method: "none", slipId: null });
  });

  it("handoff naming a missing slip links to none", () => {
    const rt = deskRuntime();
    rt.store.collection("second-look", "handoffs").put("CAP-H1", handoff({ slipId: "slip_gone" }));
    const res = linkDispute(rt.store, "CAP-H1");
    expect(res.link).toEqual({ method: "none", slipId: null });
    expect(res.warnings[0]).toMatch(/slip_gone/);
  });

  it("ignores a handoff record it can't parse", () => {
    const rt = deskRuntime();
    rt.store.collection("second-look", "handoffs").put("CAP-H1", { captureId: 42, slipId: ["x"] });
    const res = linkDispute(rt.store, "CAP-H1");
    expect(res.link.method).toBe("none");
    expect(res.warnings[0]).toMatch(/couldn't be read/);
  });
});
