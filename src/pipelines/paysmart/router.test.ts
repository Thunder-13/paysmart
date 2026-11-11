import { describe, expect, it } from "vitest";
import { finalizeRoute, mockNeeds, mockRoute } from "./router";
import { PAYSMART_DEMO_ASK, PAYSMART_EXAMPLES, USE_CASE_ROUTES, type UseCase } from "./types";

const EXPECTED: UseCase[] = ["buy", "pay_person", "group_buy", "cash_check", "paid_research", "dispute"];

describe("router", () => {
  it.each(PAYSMART_EXAMPLES.map((e, i) => [e.label, e.ask, EXPECTED[i]] as const))("routes %s", (_label, ask, useCase) => {
    const route = mockRoute(ask);
    expect(route.useCase).toBe(useCase);
    const { handoff } = finalizeRoute(route, ask);
    if (useCase === "buy") expect(handoff).toBeNull();
    else expect(handoff).toMatchObject({ useCase, path: USE_CASE_ROUTES[useCase as Exclude<UseCase, "buy">].path });
  });

  it("splits the demo ask into a dinosaur gift and a birthday card", () => {
    expect(mockNeeds(PAYSMART_DEMO_ASK)).toEqual([
      { need: "dinosaur gift", query: "dinosaur gift", quantity: 1 },
      { need: "birthday card", query: "birthday card", quantity: 1 },
    ]);
  });

  it("overrides a model that says buy when the ask has a Friends and Family phrase", () => {
    const ask = "Buy a bike from a guy, he says pay by friends and family.\nHe wants it today.";
    const raw = { useCase: "buy" as const, needs: [{ need: "bike", query: "bike", quantity: 1 }], clarify: null, summary: "A bike." };
    const { route, handoff } = finalizeRoute(raw, ask);
    expect(route.useCase).toBe("pay_person");
    expect(route.needs).toEqual([]);
    expect(handoff?.pipeline).toBe("second-look");
    expect(handoff?.quotes).toContain("Buy a bike from a guy, he says pay by friends and family.");
  });

  it("asks what to look for when a buy ask has no needs", () => {
    const { route } = finalizeRoute({ useCase: "buy", needs: [], clarify: null, summary: "" }, "hmm ok");
    expect(route.clarify).toBe("What should I look for?");
  });

  it("does not hand off a normal buy ask", () => {
    expect(finalizeRoute(mockRoute(PAYSMART_DEMO_ASK), PAYSMART_DEMO_ASK).handoff).toBeNull();
  });
});
