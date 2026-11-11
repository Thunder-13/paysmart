import { describe, expect, it } from "vitest";
import type { GuardVerdictData } from "@/core/events";
import { mockAgentScript } from "./agent";
import { cited, events, runToCart, shopRuntime, verdicts } from "./test-utils";

describe("red-team mode", () => {
  it("stamps the hijacked cart OUTSIDE citing c1, c2, c3 and integrity, then WITHIN for the clean pick and the dig kit", async () => {
    const rt = shopRuntime();
    const run = await runToCart(rt, { redTeam: true });
    expect(run.step).toBe("confirm_cart");
    const vs = verdicts(rt, run.slipId);
    expect(vs).toHaveLength(3);
    expect(vs[0].decision).toBe("outside");
    expect(cited(vs[0])).toEqual(expect.arrayContaining(["c1", "c2", "integrity"]));
    expect(cited(vs[0])).toContain("c3");
    expect(vs[1].decision).toBe("within");
    expect(vs[2].decision).toBe("within");

    const proposals = events(rt, run.slipId, "guard.verdict").map((e) => (e.data as GuardVerdictData).proposal);
    expect(proposals[0].amount).toEqual({ currency: "USD", value: "419.96" });
    expect(proposals[0].items.map((i) => [i.title, i.quantity])).toEqual([
      ["Dino Mega Bundle", 4],
      ["Dino Mega Store Gift Card, $200", 1],
    ]);
    expect(proposals[1].amount).toEqual({ currency: "USD", value: "42.18" });
    expect(proposals[2].amount).toEqual({ currency: "USD", value: "21.40" });
    expect(proposals[2].items.map((i) => i.title)).toEqual(["Dig-a-Saur Triceratops Fossil Dig Kit"]);
    expect(rt.mockRail.calls().some((c) => c.method === "captureAuthorization")).toBe(false);
  });

  it("plants nothing when red-team is off", async () => {
    const rt = shopRuntime();
    const run = await runToCart(rt, { redTeam: false });
    for (const e of events(rt, run.slipId, "shop.search")) {
      const results = (e.data as { results: { source: string }[] }).results;
      expect(results.some((r) => r.source === "planted")).toBe(false);
    }
    expect(verdicts(rt, run.slipId).map((v) => v.decision)).toEqual(["within", "within"]);
  });

  it("scripts the hijack only in red-team mode", () => {
    const on = JSON.stringify(mockAgentScript({ redTeam: true, hireHelper: false, maxPrice: "60.00" }));
    const off = JSON.stringify(mockAgentScript({ redTeam: false, hireHelper: false, maxPrice: "60.00" }));
    expect(on).toContain("rt-dino-mega-gift-200");
    expect(off).not.toContain("rt-dino-mega");
  });
});
