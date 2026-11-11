import { describe, expect, it, vi } from "vitest";
import type { MockAgentScript } from "@/core/contracts";
import { money } from "@/core/money";
import { addDemoAffiliate, events, NOW, runToCart, shopRuntime, state, waitData } from "./test-utils";

function captures(rt: ReturnType<typeof shopRuntime>) {
  return rt.mockRail.calls().filter((c) => c.method === "captureAuthorization");
}

describe("cart confirmation", () => {
  it("voids the hold and releases the helper when the cart is declined", async () => {
    const rt = shopRuntime();
    let run = await runToCart(rt, { hireHelper: true });
    const childId = state(run).helper!.childSlipId;
    run = await rt.orchestrator.resume(run.id, { approved: false });
    expect(run.status).toBe("done");
    expect(state(run).outcome).toBe("cancelled");
    const slip = rt.store.slips.get(run.slipId!)!;
    expect(rt.mockRail.inspectAuthorization(slip.rail.authorizationId!)?.status).toBe("VOIDED");
    expect(rt.store.slips.get(childId)?.status).toBe("released");
    expect(captures(rt)).toHaveLength(0);
    expect(rt.mockRail.calls().some((c) => c.method === "createPayout")).toBe(false);
  });

  it("needs an attestation for an unknown delivery date, then settles", async () => {
    const script: MockAgentScript = [
      { tool: "search_products", input: { query: "dinosaur gift" } },
      { tool: "propose_cart", input: { items: [{ listingId: "fx-clockwork-rex", quantity: 1 }], rationale: "" } },
    ];
    const rt = shopRuntime({ shop: { agentScript: () => script } });
    const json = rt.ai.json.bind(rt.ai);
    vi.spyOn(rt.ai, "json").mockImplementation(async (req) => {
      const out = await json(req);
      return req.label === "extract-facts" ? ({ ...(out as object), deliveryEstimate: null } as typeof out) : out;
    });
    let run = await runToCart(rt, {});
    expect(state(run).cartVerdict?.decision).toBe("ask");
    expect((waitData(run).unknowns as { clauseId: string }[])[0].clauseId).toBe("c4");

    run = await rt.orchestrator.resume(run.id, { approved: true });
    expect(run.step).toBe("confirm_cart");
    expect(String(run.wait?.message)).toMatch(/Please confirm: c4 deliveryEstimate/);

    run = await rt.orchestrator.resume(run.id, { approved: true, attestations: [{ field: "deliveryEstimate", value: "2026-11-13" }] });
    expect(run.step).toBe("verify_delivery");
    const attested = events(rt, run.slipId, "shop.attested");
    expect(attested).toHaveLength(1);
    expect(attested[0].actor).toBe("user");
    expect(captures(rt)).toHaveLength(1);
  });
});

describe("choosing an option", () => {
  it("captures $21.40 and releases $38.60 for option 2, and records the choice", async () => {
    const rt = shopRuntime();
    let run = await runToCart(rt, {});
    run = await rt.orchestrator.resume(run.id, { approved: true, optionId: "opt-2", via: "keyboard" });
    expect(run.step).toBe("verify_delivery");
    const caps = captures(rt);
    expect(caps).toHaveLength(1);
    expect(caps[0].args[1]).toMatchObject({ amount: money("21.40"), finalCapture: true });
    expect(state(run).totals).toMatchObject({ held: money("60.00"), captured: money("21.40"), released: money("38.60") });
    expect(state(run).cart?.amount).toEqual(money("21.40"));
    expect(state(run).cartLines.map((l) => l.listingId)).toEqual(["fx-dig-kit"]);
    expect(state(run).chosenOptionId).toBe("opt-2");
    const chosen = events(rt, run.slipId, "shop.option_chosen");
    expect(chosen).toHaveLength(1);
    expect(chosen[0].actor).toBe("user");
    expect(chosen[0].data).toMatchObject({ optionId: "opt-2", rank: 2, amount: money("21.40"), via: "keyboard" });
  });

  it("re-waits for a forged option id with no capture and no state change", async () => {
    const rt = shopRuntime();
    let run = await runToCart(rt, {});
    run = await rt.orchestrator.resume(run.id, { approved: true, optionId: "opt-99" });
    expect(run.status).toBe("waiting");
    expect(run.step).toBe("confirm_cart");
    expect(String(run.wait?.message)).toMatch(/That option is not on the list/);
    expect(captures(rt)).toHaveLength(0);
    expect(state(run).chosenOptionId).toBe("opt-1");
    expect(state(run).cart?.amount).toEqual(money("42.18"));
    expect(events(rt, run.slipId, "shop.option_chosen")).toHaveLength(0);
  });

  it("captures $42.18 and releases $17.82 when no optionId is sent", async () => {
    const rt = shopRuntime();
    let run = await runToCart(rt, {});
    run = await rt.orchestrator.resume(run.id, { approved: true });
    expect(captures(rt)[0].args[1]).toMatchObject({ amount: money("42.18"), finalCapture: true });
    expect(state(run).totals?.released).toEqual(money("17.82"));
    expect(events(rt, run.slipId, "shop.option_chosen")[0].data).toMatchObject({ optionId: "opt-1", rank: 1 });
  });

  it("re-waits and keeps the earlier selection when the switched-to option fails the re-check", async () => {
    const rt = shopRuntime();
    let run = await runToCart(rt, {});
    const evaluate = rt.core.evaluate.bind(rt.core);
    vi.spyOn(rt.core, "evaluate").mockImplementation((slipId, proposal) => {
      const v = evaluate(slipId, proposal);
      return proposal.items.some((i) => /Dig-a-Saur/.test(i.title)) ? { ...v, decision: "outside", violations: [{ clauseId: "c4", message: "late" }] } : v;
    });
    run = await rt.orchestrator.resume(run.id, { approved: true, optionId: "opt-2" });
    expect(run.step).toBe("confirm_cart");
    expect(String(run.wait?.message)).toMatch(/Option 2 is no longer within the slip \(c4\)/);
    expect(state(run).chosenOptionId).toBe("opt-1");
    expect(captures(rt)).toHaveLength(0);
  });

  it("re-waits citing c6 when the slip has expired by the time another option is picked", async () => {
    let clock = new Date(NOW);
    const rt = shopRuntime({ now: () => clock });
    let run = await runToCart(rt, {});
    clock = new Date(Date.parse(NOW) + 80 * 3_600_000);
    run = await rt.orchestrator.resume(run.id, { approved: true, optionId: "opt-2" });
    expect(run.step).toBe("confirm_cart");
    expect(String(run.wait?.message)).toMatch(/c6/);
    expect(captures(rt)).toHaveLength(0);
    expect(events(rt, run.slipId, "shop.option_chosen")).toHaveLength(0);
  });
});

describe("affiliate attribution", () => {
  it("records one affiliate.attributed with a $1.68 estimate on $42.18", async () => {
    const rt = shopRuntime();
    const account = addDemoAffiliate(rt);
    let run = await runToCart(rt, {});
    expect(events(rt, run.slipId, "affiliate.attributed")).toHaveLength(0);
    run = await rt.orchestrator.resume(run.id, { approved: true });
    const ev = events(rt, run.slipId, "affiliate.attributed");
    expect(ev).toHaveLength(1);
    expect(ev[0].actor).toBe("system");
    expect(ev[0].data).toMatchObject({
      listingId: "fx-clockwork-rex",
      accountId: account.id,
      url: "https://dinodepot.example/p/fx-clockwork-rex?ref=permission-slip-demo",
      lineTotal: money("42.18"),
      estCommission: money("1.68"),
    });
    expect(state(run).affiliate).toMatchObject({ estCommission: money("1.68"), reversed: false });
  });

  it("attributes the chosen option only", async () => {
    const rt = shopRuntime();
    addDemoAffiliate(rt);
    let run = await runToCart(rt, {});
    run = await rt.orchestrator.resume(run.id, { approved: true, optionId: "opt-2" });
    const ev = events(rt, run.slipId, "affiliate.attributed");
    expect(ev.map((e) => (e.data as { listingId: string }).listingId)).toEqual(["fx-dig-kit"]);
    expect(state(run).affiliate?.estCommission).toEqual(money("0.85"));
  });

  it("records nothing when no account matches", async () => {
    const rt = shopRuntime();
    let run = await runToCart(rt, {});
    run = await rt.orchestrator.resume(run.id, { approved: true });
    expect(events(rt, run.slipId).filter((e) => e.type.startsWith("affiliate."))).toHaveLength(0);
    expect(state(run).affiliate).toBeNull();
  });
});

describe("settlement", () => {
  it("captures $42.18 once with final capture and releases $17.82", async () => {
    const rt = shopRuntime();
    let run = await runToCart(rt, { redTeam: true });
    run = await rt.orchestrator.resume(run.id, { approved: true, via: "voice" });
    expect(run.step).toBe("verify_delivery");
    expect(run.wait?.kind).toBe("user_upload");
    const caps = captures(rt);
    expect(caps).toHaveLength(1);
    expect(caps[0].args[1]).toMatchObject({ amount: money("42.18"), finalCapture: true });
    expect(state(run).approvedVia).toBe("voice");
    expect(state(run).totals).toEqual({ held: money("60.00"), captured: money("42.18"), released: money("17.82"), refunded: money("0.00") });
    expect(rt.store.slips.get(run.slipId!)?.status).toBe("settled");
  });

  it("pays the helper $3.00 before capturing $45.18 and releasing $14.82", async () => {
    const rt = shopRuntime();
    let run = await runToCart(rt, { redTeam: true, hireHelper: true });
    run = await rt.orchestrator.resume(run.id, { approved: true });
    expect(run.step).toBe("verify_delivery");
    const methods = rt.mockRail.calls().map((c) => c.method);
    expect(methods.indexOf("createPayout")).toBeGreaterThan(-1);
    expect(methods.indexOf("createPayout")).toBeLessThan(methods.indexOf("captureAuthorization"));
    const payout = rt.mockRail.calls().find((c) => c.method === "createPayout")!;
    expect(JSON.stringify(payout.args)).toContain("card-writer@helpers.example");
    expect(captures(rt)[0].args[1]).toMatchObject({ amount: money("45.18"), finalCapture: true });
    expect(state(run).totals?.released).toEqual(money("14.82"));
    expect(state(run).helper?.status).toBe("paid");
    const child = rt.store.slips.get(state(run).helper!.childSlipId)!;
    expect(child.status).toBe("settled");
    expect(child.spent).toEqual(money("3.00"));
  });

  it("voids the hold and ends capture_failed when PayPal refuses the capture", async () => {
    const rt = shopRuntime();
    let run = await runToCart(rt, {});
    vi.spyOn(rt.rail, "captureAuthorization").mockRejectedValue(new Error("AUTHORIZATION_EXPIRED"));
    run = await rt.orchestrator.resume(run.id, { approved: true });
    expect(run.status).toBe("done");
    expect(state(run).outcome).toBe("capture_failed");
    const slip = rt.store.slips.get(run.slipId!)!;
    expect(rt.mockRail.inspectAuthorization(slip.rail.authorizationId!)?.status).toBe("VOIDED");
    expect(events(rt, run.slipId, "shop.capture_failed")).toHaveLength(1);
  });

  it("blocks an approval that arrives after the slip expired", async () => {
    let clock = new Date(NOW);
    const rt = shopRuntime({ now: () => clock });
    let run = await runToCart(rt, {});
    clock = new Date(Date.parse(NOW) + 80 * 3_600_000);
    run = await rt.orchestrator.resume(run.id, { approved: true });
    expect(run.status).toBe("done");
    expect(state(run).outcome).toBe("blocked");
    expect(state(run).cartVerdict?.violations.map((v) => v.clauseId)).toContain("c6");
    expect(captures(rt)).toHaveLength(0);
    const slip = rt.store.slips.get(run.slipId!)!;
    expect(rt.mockRail.inspectAuthorization(slip.rail.authorizationId!)?.status).toBe("VOIDED");
  });
});
