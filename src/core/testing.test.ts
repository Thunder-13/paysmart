import { afterEach, describe, expect, it, vi } from "vitest";
import { money } from "./money";
import { newProposal, newSlipInput } from "./test-helpers";
import { createTestRuntime, tamperEvent } from "./testing";

afterEach(() => {
  vi.useRealTimers();
});

describe("createTestRuntime", () => {
  it("wires the registry pipelines, mock rail and mock AI", () => {
    const rt = createTestRuntime();
    expect(rt.rail.mode).toBe("mock");
    expect(rt.ai.mode).toBe("mock");
    expect(Object.keys(rt.orchestrator)).toContain("start");
    expect(typeof rt.mockRail.approveOrder).toBe("function");
    expect(rt.baseUrl).toBe("http://localhost:3000");
  });

  it("follows vi.setSystemTime by default and honors an explicit clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-01-02T03:04:05.000Z"));
    const rt = createTestRuntime();
    expect(rt.now().toISOString()).toBe("2027-01-02T03:04:05.000Z");
    const slip = rt.core.createSlip(newSlipInput());
    expect(slip.createdAt).toBe("2027-01-02T03:04:05.000Z");
    vi.useRealTimers();

    const fixed = createTestRuntime({ now: () => new Date("2026-11-08T00:00:00.000Z") });
    const s2 = fixed.core.createSlip(newSlipInput({ expiresAt: "2026-11-07T00:00:00.000Z", clauses: [{ id: "c1", kind: "expires_at", label: "Ended", at: "2026-11-07T00:00:00.000Z" }] }));
    expect(fixed.core.evaluate(s2.id, newProposal({ slipId: s2.id, amount: money("1") })).decision).toBe("outside");
  });

  it("tamperEvent breaks the chain at the given seq", () => {
    const rt = createTestRuntime({ pipelines: {} as never });
    const slip = rt.core.createSlip(newSlipInput());
    rt.core.evaluate(slip.id, newProposal({ slipId: slip.id }));
    rt.core.addEvidence(slip.id, { kind: "tracking", verdict: "pass", detail: "ok", ref: null });
    expect(rt.store.ledger.verifyChain(slip.id).ok).toBe(true);
    tamperEvent(rt.store, slip.id, 2);
    expect(rt.store.ledger.verifyChain(slip.id)).toEqual({ ok: false, brokenAtSeq: 2 });
  });
});
