import { describe, expect, it } from "vitest";
import { createTestRuntime } from "@/core/testing";
import { listAlerts, writeAlert } from "./family";
import secondLook from "./index";

const base = {
  slipId: "slip_1",
  runId: "run_1",
  reason: "high_risk" as const,
  riskScore: 86,
  band: "high" as const,
  headline: "Four scam signs",
  tactics: [{ id: "ff_request" as const, label: "Friends and Family request", quote: "send it friends and family" }],
  buyerName: "Alex",
  sellerEmail: "dana@example.com",
  amount: { currency: "USD", value: "180.00" },
};

describe("second-look family alerts", () => {
  it("writes one alert per run and reason", () => {
    const rt = createTestRuntime({ pipelines: { "second-look": secondLook }, seedRail: false });
    const now = new Date("2026-11-09T10:00:00.000Z");
    const a = writeAlert(rt.store, { ...base, to: " Mom@Example.com " }, now);
    const b = writeAlert(rt.store, { ...base, to: "mom@example.com" }, now);
    const c = writeAlert(rt.store, { ...base, to: "mom@example.com", reason: "seller_refused" }, new Date("2026-11-09T11:00:00.000Z"));
    expect(a?.to).toBe("mom@example.com");
    expect(b?.id).toBe(a?.id);
    expect(c?.id).not.toBe(a?.id);
    expect(listAlerts(rt.store, "MOM@example.com").map((x) => x.reason)).toEqual(["seller_refused", "high_risk"]);
    expect(listAlerts(rt.store, "someone@else.com")).toEqual([]);
  });

  it("writes nothing without a trusted contact", () => {
    const rt = createTestRuntime({ pipelines: { "second-look": secondLook }, seedRail: false });
    expect(writeAlert(rt.store, { ...base, to: undefined }, new Date())).toBeNull();
    expect(writeAlert(rt.store, { ...base, to: "  " }, new Date())).toBeNull();
    expect(listAlerts(rt.store)).toEqual([]);
  });
});
