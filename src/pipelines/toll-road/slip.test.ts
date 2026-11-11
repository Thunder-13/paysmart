import { describe, expect, it } from "vitest";
import { createTestRuntime } from "@/core/testing";
import { mockCompile, parseIntent, withRateCard } from "./slip";
import { DEFAULT_INTENT } from "./types";

describe("toll slip compiler", () => {
  it("default intent compiles to budget_max 0.15, rate_card fetch 0.05, expires_at +60m", async () => {
    const now = new Date("2026-11-10T15:00:00.000Z");
    const rt = createTestRuntime({ now: () => now });
    const compiled = await rt.core.compileSlip({
      pipeline: "toll-road",
      intent: DEFAULT_INTENT,
      principal: { name: "Research desk", email: null },
      mock: () => mockCompile(DEFAULT_INTENT, now),
    });
    expect(compiled.budget.value).toBe("0.15");
    const kinds = compiled.clauses.map((c) => c.kind);
    expect(kinds).toEqual(["budget_max", "rate_card", "expires_at"]);
    const rate = compiled.clauses.find((c) => c.kind === "rate_card");
    expect(rate).toMatchObject({ unit: "fetch", price: { value: "0.05" } });
    expect(compiled.expiresAt).toBe("2026-11-10T16:00:00.000Z");
  });

  it("reads other amounts and durations", () => {
    expect(parseIntent("Spend up to $2.00 at $0.10 per article for 2 hours")).toMatchObject({
      budget: { value: "2.00" },
      cap: { value: "0.10" },
      minutes: 120,
    });
    expect(parseIntent("Up to $1, 3 cents each, 15 minutes")).toMatchObject({ budget: { value: "1.00" }, cap: { value: "0.03" }, minutes: 15 });
    expect(parseIntent("read some articles")).toMatchObject({ budget: { value: "0.15" }, cap: { value: "0.05" }, minutes: 60 });
  });

  it("adds a rate card when a live compiler leaves it out", () => {
    const clauses = withRateCard([{ id: "c1", kind: "budget_max", label: "b", amount: { currency: "USD", value: "1.00" } }], "4 cents each");
    expect(clauses).toHaveLength(2);
    expect(clauses[1]).toMatchObject({ id: "c2", kind: "rate_card", unit: "fetch", price: { value: "0.04" } });
  });
});
