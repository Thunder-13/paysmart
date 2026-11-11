import { describe, expect, it } from "vitest";
import { money } from "@/core/money";
import type { Clause } from "@/core/contracts";
import { amountFromAsk, mockCompile, requestScreens } from "./compile";
import { mockNeeds } from "./router";
import { PAYSMART_DEMO_ASK } from "./types";

const NOW = new Date("2026-11-08T18:00:00.000Z");

function demo() {
  return mockCompile(PAYSMART_DEMO_ASK, mockNeeds(PAYSMART_DEMO_ASK), NOW);
}

describe("paysmart mockCompile", () => {
  it("builds the demo slip: $60, two items, greeting card, Saturday, no batteries", () => {
    const c = demo();
    expect(c.budget).toEqual(money("60.00"));
    expect(c.clauses.map((x) => [x.id, x.kind])).toEqual([
      ["c1", "budget_max"],
      ["c2", "quantity_max"],
      ["c3", "category_in"],
      ["c4", "deliver_by"],
      ["c5", "exclude_attribute"],
      ["c6", "expires_at"],
    ]);
    expect(c.clauses[1]).toMatchObject({ count: 2 });
    expect(c.clauses[2]).toMatchObject({ categories: expect.arrayContaining(["toy", "gift", "greeting_card"]) });
    expect(c.clauses[3]).toMatchObject({ date: "2026-11-14" });
  });

  it("reads a bare number answer as dollars", () => {
    expect(amountFromAsk("a kettle\n40")).toEqual(money("40"));
    expect(amountFromAsk("a kettle")).toEqual(money("0"));
  });
});

describe("request screen", () => {
  const ask = PAYSMART_DEMO_ASK;
  it("passes the demo slip", () => {
    const c = demo();
    const r = requestScreens({ clauses: c.clauses, budget: c.budget, ask, now: NOW });
    expect(r.question).toBeNull();
    expect(r.results.every((x) => x.screen === "request" && x.status === "pass")).toBe(true);
  });

  it("asks for a limit when the ask names no amount", () => {
    const text = "a birthday card for my aunt";
    const c = mockCompile(text, mockNeeds(text), NOW);
    const r = requestScreens({ clauses: c.clauses, budget: c.budget, ask: text, now: NOW });
    expect(r.question).toBe("How much can you spend in total?");
    expect(r.results.some((x) => x.status === "fail")).toBe(true);
  });

  it("sends a limit over $1,000.00 back with the cap in the question", () => {
    const text = "a gaming laptop under $5,000";
    const c = mockCompile(text, mockNeeds(text), NOW);
    const r = requestScreens({ clauses: c.clauses, budget: c.budget, ask: text, now: NOW });
    expect(r.question).toMatch(/caps one ask at \$1,000\.00/);
  });

  it("fails a gift_card category the ask never mentions, and allows it when asked for", () => {
    const c = demo();
    const clauses: Clause[] = c.clauses.map((x) => (x.kind === "category_in" ? { ...x, categories: ["toy", "gift_card"] } : x));
    expect(requestScreens({ clauses, budget: c.budget, ask, now: NOW }).question).toMatch(/gift cards/);
    expect(requestScreens({ clauses, budget: c.budget, ask: `${ask} A gift card works too.`, now: NOW }).question).toBeNull();
  });
});
