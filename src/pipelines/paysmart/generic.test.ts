import { describe, expect, it } from "vitest";
import { money } from "@/core/money";
import { events, paysmartRuntime, railCalls, runToChoose, state, waitData } from "./test-utils";

const BOOK_ASK = "A dinosaur book under $20, arrives by Saturday";

function channel3Fetch(products: unknown[]): typeof fetch {
  return (async () => new Response(JSON.stringify({ products }), { status: 200 })) as unknown as typeof fetch;
}

const offer = (price: number, domain: string) => [{ url: `https://${domain}/item`, domain, price: { price, currency: "USD" }, availability: "InStock" }];

describe("generic mock agent (asks that are not the demo)", () => {
  it("a single-need ask gets a WITHIN option and is paid end to end", async () => {
    const rt = paysmartRuntime();
    let run = await runToChoose(rt, { ask: BOOK_ASK });
    const s = state(run);
    expect(s.route?.needs.map((n) => n.need)).toEqual(["dinosaur book"]);
    expect(s.options.length).toBeGreaterThanOrEqual(1);
    expect(s.options[0].verdict.decision).toBe("within");
    expect(s.options[0].lines.map((l) => l.listingId)).toEqual(["fx-dino-book"]);
    expect(s.options[0].proposal.amount).toEqual(money("14.99"));
    run = await rt.orchestrator.resume(run.id, { approved: true });
    rt.mockRail.approveOrder(String(waitData(run).orderId), "buyer@example.com");
    run = await rt.orchestrator.resume(run.id, { approved: true, orderId: String(waitData(run).orderId) });
    run = await rt.orchestrator.resume(run.id, { skip: true });
    expect(state(run).outcome).toBe("paid");
    expect(state(run).totals).toMatchObject({ held: money("14.99"), captured: money("14.99"), released: money("0.00") });
    expect(railCalls(rt, "captureAuthorization")).toHaveLength(1);
  });

  it("builds options from stubbed Channel3 listings in mock AI mode", async () => {
    const products = [
      { id: "a", title: "Wind-up dinosaur toy", description: "Wind-up dinosaur toy, no batteries.", offers: offer(30, "shop-a.example") },
      { id: "b", title: "Dinosaur toy mid", description: "Wind-up dinosaur toy, no batteries.", offers: offer(20, "shop-b.example") },
      { id: "c", title: "Dinosaur toy cheap", description: "Wind-up dinosaur toy, no batteries.", offers: offer(12, "shop-c.example") },
    ];
    const rt = paysmartRuntime({ paysmart: { channel3ApiKey: () => "key", fetch: channel3Fetch(products) } });
    const run = await runToChoose(rt, { ask: "A dinosaur toy under $50" });
    const s = state(run);
    expect(s.catalogSource).toBe("channel3");
    expect(s.searches[0].source).toBe("channel3");
    expect(s.options.map((o) => [o.id, o.verdict.decision, o.lines.map((l) => l.listingId), o.proposal.amount.value])).toEqual([
      ["opt-1", "within", ["c3-a"], "30.00"],
      ["opt-2", "within", ["c3-c"], "12.00"],
      ["opt-3", "within", ["c3-b"], "20.00"],
    ]);
    expect(s.options.every((o) => o.lines.every((l) => l.source === "channel3"))).toBe(true);
    expect(events(rt, run.slipId, "guard.verdict")).toHaveLength(3);
  });

  it("leaves out a need with no candidate and says so in the rationale", async () => {
    const rt = paysmartRuntime();
    const run = await runToChoose(rt, { ask: "A dinosaur book, plus a zebra umbrella. Under $40." });
    const s = state(run);
    expect(s.route?.needs.map((n) => n.need)).toEqual(["dinosaur book", "zebra umbrella"]);
    expect(s.options[0].lines.map((l) => l.listingId)).toEqual(["fx-dino-book"]);
    expect(s.options[0].rationale).toMatch(/No zebra umbrella passed the screens\./);
  });

  it("ends no_options when nothing passes", async () => {
    const rt = paysmartRuntime();
    const run = await rt.orchestrator.start("paysmart", { ask: "A zebra umbrella under $40." });
    expect(state(run).outcome).toBe("no_options");
    expect(state(run).note).toMatch(/No cart fit your slip/);
  });

  it("keeps the demo path: opt-1 $47.17 and opt-2 $26.39", async () => {
    const rt = paysmartRuntime();
    const run = await runToChoose(rt);
    expect(state(run).options.map((o) => [o.id, o.proposal.amount.value])).toEqual([
      ["opt-1", "47.17"],
      ["opt-2", "26.39"],
    ]);
  });

  it("falls back to ask-stamped Channel3 products, and attesting the unknown facts makes the cart pay", async () => {
    const products = [{ id: "u", title: "Dinosaur toy", description: "A dinosaur toy.", offers: offer(25, "shop-u.example") }];
    const rt = paysmartRuntime({ paysmart: { channel3ApiKey: () => "key", fetch: channel3Fetch(products) } });
    let run = await runToChoose(rt, { ask: "A dinosaur toy under $50, arrives by Saturday. Nothing that needs batteries." });
    const s = state(run);
    expect(s.options).toHaveLength(1);
    expect(s.options[0].verdict.decision).toBe("ask");
    expect(s.options[0].verdict.unknowns.map((u) => u.field).sort()).toEqual(["attributes.power_source", "deliveryEstimate"]);
    expect(s.options[0].rationale).toMatch(/Delivery date unknown for this listing; you confirm it before paying\./);
    expect(railCalls(rt)).toHaveLength(0);

    run = await rt.orchestrator.resume(run.id, { approved: true });
    expect(run.step).toBe("choose");
    expect(String(run.wait?.message)).toMatch(/Please confirm/);

    run = await rt.orchestrator.resume(run.id, {
      approved: true,
      attestations: [
        { field: "deliveryEstimate", value: "2026-11-13" },
        { field: "attributes.power_source", value: "none" },
      ],
    });
    expect(run.step).toBe("complete_signing");
    rt.mockRail.approveOrder(String(waitData(run).orderId), "buyer@example.com");
    run = await rt.orchestrator.resume(run.id, { approved: true, orderId: String(waitData(run).orderId) });
    run = await rt.orchestrator.resume(run.id, { skip: true });
    expect(state(run).outcome).toBe("paid");
    expect(state(run).totals).toMatchObject({ captured: money("25.00"), released: money("0.00") });
    expect(events(rt, run.slipId, "paysmart.attested")).toHaveLength(2);
  });

  it("uses only pass candidates when a need has both pass and ask candidates", async () => {
    const products = [
      { id: "u", title: "Dinosaur toy unknown power", description: "A dinosaur toy.", offers: offer(10, "shop-u.example") },
      { id: "k", title: "Dinosaur toy wind-up", description: "Wind-up dinosaur toy.", offers: offer(30, "shop-k.example") },
    ];
    const rt = paysmartRuntime({ paysmart: { channel3ApiKey: () => "key", fetch: channel3Fetch(products) } });
    const run = await runToChoose(rt, { ask: "A dinosaur toy under $50. Nothing that needs batteries." });
    const s = state(run);
    expect(s.products.find((p) => p.listingId === "c3-u")?.screens.find((x) => x.screen === "slip")?.status).toBe("ask");
    expect(s.options.map((o) => [o.verdict.decision, o.lines.map((l) => l.listingId)])).toEqual([["within", ["c3-k"]]]);
  });
});
