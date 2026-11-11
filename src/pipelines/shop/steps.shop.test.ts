import { describe, expect, it } from "vitest";
import type { MockAgentScript } from "@/core/contracts";
import { events, runToCart, shopRuntime, state, waitData } from "./test-utils";

describe("shop step", () => {
  it("waits on the cart with capture $42.18 and release $17.82", async () => {
    const rt = shopRuntime();
    const run = await runToCart(rt, { redTeam: true });
    expect(run.status).toBe("waiting");
    expect(run.step).toBe("confirm_cart");
    const totals = waitData(run).totals as Record<string, unknown>;
    expect(totals.capture).toEqual({ currency: "USD", value: "42.18" });
    expect(totals.release).toEqual({ currency: "USD", value: "17.82" });
    expect(state(run).proposals).toBe(3);
    expect(state(run).cartLines.map((l) => l.listingId)).toEqual(["fx-clockwork-rex"]);
    const says = events(rt, run.slipId, "agent.step");
    expect(says.length).toBeGreaterThan(2);
    expect(says.every((e) => e.actor === "agent")).toBe(true);
  });

  it("offers two options in a clean run, default Clockwork Rex, with per-option totals", async () => {
    const rt = shopRuntime();
    const run = await runToCart(rt, {});
    const d = waitData(run) as {
      options: { id: string; rank: number; verdict: { decision: string }; totals: { capture: unknown; release: unknown }; proposal: { amount: unknown } }[];
      ruledOut: unknown[];
      selectedOptionId: string;
    };
    expect(d.options.map((o) => [o.id, o.rank, o.verdict.decision])).toEqual([
      ["opt-1", 1, "within"],
      ["opt-2", 2, "within"],
    ]);
    expect(d.options[0].proposal.amount).toEqual({ currency: "USD", value: "42.18" });
    expect(d.options[1].proposal.amount).toEqual({ currency: "USD", value: "21.40" });
    expect(d.options[1].totals).toMatchObject({ capture: { currency: "USD", value: "21.40" }, release: { currency: "USD", value: "38.60" } });
    expect(d.selectedOptionId).toBe("opt-1");
    expect(d.ruledOut).toEqual([]);
    expect(state(run).chosenOptionId).toBe("opt-1");
    expect(state(run).cart?.amount).toEqual({ currency: "USD", value: "42.18" });
  });

  it("puts the hijacked cart in ruledOut and out of the options in red-team mode", async () => {
    const rt = shopRuntime();
    const run = await runToCart(rt, { redTeam: true });
    const s = state(run);
    expect(s.proposals).toBe(3);
    expect(s.options.map((o) => o.lines.map((l) => l.listingId))).toEqual([["fx-clockwork-rex"], ["fx-dig-kit"]]);
    expect(s.ruledOut).toHaveLength(1);
    expect(s.ruledOut[0].amount).toEqual({ currency: "USD", value: "419.96" });
    expect(s.ruledOut[0].clauseIds).toEqual(expect.arrayContaining(["c1", "c2", "integrity"]));
    const d = waitData(run) as { ruledOut: unknown[]; options: { lines: { source: string }[] }[] };
    expect(d.ruledOut).toHaveLength(1);
    expect(d.options.flatMap((o) => o.lines).some((l) => l.source === "planted")).toBe(false);
  });

  it("ends no_cart and voids the hold when every proposal is outside", async () => {
    const bad: MockAgentScript = [
      { tool: "search_products", input: { query: "dinosaur gift" } },
      { tool: "propose_cart", input: { items: [{ listingId: "fx-roar-plush", quantity: 1 }], rationale: "" } },
      { tool: "propose_cart", input: { items: [{ listingId: "fx-volcano-light", quantity: 1 }], rationale: "" } },
      { tool: "propose_cart", input: { items: [{ listingId: "fx-pocket-raptors", quantity: 1 }], rationale: "" } },
      { say: "Nothing fits." },
    ];
    const rt = shopRuntime({ shop: { agentScript: () => bad } });
    const run = await runToCart(rt, {});
    expect(run.status).toBe("done");
    expect(state(run).outcome).toBe("no_cart");
    expect(state(run).ruledOut).toHaveLength(3);
    expect(state(run).options).toEqual([]);
    const slip = rt.store.slips.get(run.slipId!)!;
    expect(slip.status).toBe("released");
    expect(rt.mockRail.inspectAuthorization(slip.rail.authorizationId!)?.status).toBe("VOIDED");
    expect(rt.mockRail.calls().some((c) => c.method === "captureAuthorization")).toBe(false);
  });
});
