import { describe, expect, it } from "vitest";
import { money } from "@/core/money";
import { allocate } from "./allocate";

const p = (slipId: string, value: string, signedAt: string) => ({ slipId, budget: money(value), signedAt });

describe("allocate", () => {
  it("gives every pledge its full amount when they add up to the reward", () => {
    const out = allocate(money("40.00"), [p("a", "25.00", "2026-11-10T12:01:00Z"), p("b", "15.00", "2026-11-10T12:02:00Z")]);
    expect(out).toEqual([
      { slipId: "a", amount: money("25.00") },
      { slipId: "b", amount: money("15.00") },
    ]);
  });

  it("gives the last pledge 0.00 when earlier ones cover the reward", () => {
    const out = allocate(money("40.00"), [
      p("c", "10.00", "2026-11-10T12:03:00Z"),
      p("a", "30.00", "2026-11-10T12:01:00Z"),
      p("b", "10.00", "2026-11-10T12:02:00Z"),
    ]);
    expect(out.map((x) => [x.slipId, x.amount.value])).toEqual([
      ["a", "30.00"],
      ["b", "10.00"],
      ["c", "0.00"],
    ]);
  });

  it("trims a pledge that straddles the reward", () => {
    const out = allocate(money("40.00"), [p("a", "30.00", "1"), p("b", "25.00", "2")]);
    expect(out[1].amount.value).toBe("10.00");
  });

  it("breaks signing-time ties on slip id", () => {
    const out = allocate(money("10.00"), [p("slip_b", "10.00", "same"), p("slip_a", "10.00", "same")]);
    expect(out.map((x) => [x.slipId, x.amount.value])).toEqual([
      ["slip_a", "10.00"],
      ["slip_b", "0.00"],
    ]);
  });
});
