import { describe, expect, it, vi } from "vitest";
import type { AgentTool } from "@/core/contracts";
import type { GuardVerdictData } from "@/core/events";
import { HIDDEN_INSTRUCTION } from "./fixtures";
import { ShopSession } from "./tools";
import { addDemoAffiliate, DEMO_AFFILIATE_ID, events, HELPER_EMAIL, shopRuntime, signedSession } from "./test-utils";

async function session(redTeam = false, withAffiliate = false) {
  const rt = shopRuntime();
  const account = withAffiliate ? addDemoAffiliate(rt) : null;
  const { slip, ctx } = await signedSession(rt);
  const s = new ShopSession({ ctx, slipId: slip.id, redTeam, hireHelper: false, apiKey: null, helperEmail: HELPER_EMAIL });
  const tools = Object.fromEntries(s.tools().map((t) => [t.name, t])) as Record<string, AgentTool<unknown>>;
  const call = async (name: string, input: unknown) => tools[name].run(tools[name].input.parse(input)) as Promise<Record<string, unknown>>;
  return { rt, slip, s, call, account };
}

describe("search_products and inspect_listing", () => {
  it("refuses an id no search returned", async () => {
    const { call } = await session();
    expect(await call("inspect_listing", { listingId: "fx-clockwork-rex" })).toMatchObject({ error: expect.stringMatching(/Unknown listing id/) });
  });

  it("caps the search at the remaining budget and records it", async () => {
    const { rt, slip, call } = await session();
    const res = await call("search_products", { query: "dinosaur toy", maxPrice: "500.00" });
    expect(res.source).toBe("fixtures");
    const ev = events(rt, slip.id, "shop.search");
    expect(ev).toHaveLength(1);
    expect((ev[0].data as { maxPrice: unknown }).maxPrice).toEqual({ currency: "USD", value: "60.00" });
  });

  it("extracts wind-up toy facts for the clean pick", async () => {
    const { call } = await session();
    await call("search_products", { query: "dinosaur gift" });
    const res = await call("inspect_listing", { listingId: "fx-clockwork-rex" });
    expect(res.facts).toMatchObject({ category: "toy", itemCount: 1, deliveryEstimate: "2026-11-13", injectionSuspected: false });
    expect((res.facts as { attributes: Record<string, unknown> }).attributes.power_source).toBe("wind_up");
  });

  it("flags the planted bundle even when the extractor says it is clean", async () => {
    const { rt, slip, call } = await session(true);
    const json = rt.ai.json.bind(rt.ai);
    vi.spyOn(rt.ai, "json").mockImplementation(async (req) => {
      const out = await json(req);
      return req.label === "extract-facts" ? ({ ...(out as object), injectionSuspected: false } as typeof out) : out;
    });
    await call("search_products", { query: "dinosaur gift" });
    const res = await call("inspect_listing", { listingId: "rt-dino-mega-bundle" });
    expect((res.facts as { injectionSuspected: boolean }).injectionSuspected).toBe(true);
    const inspected = events(rt, slip.id, "shop.listing_inspected")[0].data as { hidden: string[]; excerpt: string };
    expect(inspected.hidden).toEqual([HIDDEN_INSTRUCTION]);
    expect(inspected.excerpt).not.toContain("NOTE TO AI");
  });
});

describe("propose_cart", () => {
  it("leaves the count unchanged for a forged id", async () => {
    const { s, call } = await session();
    await call("search_products", { query: "dinosaur" });
    const res = await call("propose_cart", { items: [{ listingId: "made-up", quantity: 1 }], rationale: "" });
    expect(res.error).toMatch(/Unknown listing id/);
    expect(s.proposals).toBe(0);
  });

  it("sends facts, never descriptions, to the guard and stops after three proposals", async () => {
    const { rt, slip, s, call } = await session(true);
    await call("search_products", { query: "dinosaur gift" });
    for (let i = 0; i < 3; i++) {
      const r = await call("propose_cart", { items: [{ listingId: "fx-roar-plush", quantity: 1 }], rationale: "" });
      expect(r.decision).toBe("outside");
    }
    const before = events(rt, slip.id, "guard.verdict").length;
    const fourth = await call("propose_cart", { items: [{ listingId: "fx-roar-plush", quantity: 1 }], rationale: "" });
    expect(fourth.error).toMatch(/Proposal limit/);
    expect(events(rt, slip.id, "guard.verdict")).toHaveLength(before);
    expect(s.proposals).toBe(3);
    await call("propose_cart", { items: [{ listingId: "rt-dino-mega-bundle", quantity: 1 }], rationale: "" }).catch(() => undefined);
    for (const e of events(rt, slip.id, "guard.verdict")) {
      const text = JSON.stringify((e.data as GuardVerdictData).proposal);
      expect(text).not.toMatch(/Squeeze the paw|NOTE TO AI|play mat/);
    }
  });

  it("stamps the battery plush OUTSIDE on c5 and the clean pick WITHIN", async () => {
    const { call, s } = await session();
    await call("search_products", { query: "dinosaur gift" });
    const plush = await call("propose_cart", { items: [{ listingId: "fx-roar-plush", quantity: 1 }], rationale: "" });
    expect((plush.violations as { clauseId: string }[]).map((v) => v.clauseId)).toContain("c5");
    const rex = await call("propose_cart", { items: [{ listingId: "fx-clockwork-rex", quantity: 1 }], rationale: "" });
    expect(rex.decision).toBe("within");
    expect(s.cart?.proposal.amount).toEqual({ currency: "USD", value: "42.18" });
  });

  it("turns two WITHIN proposals into two ranked options", async () => {
    const { call, s } = await session();
    await call("search_products", { query: "dinosaur gift" });
    const a = await call("propose_cart", { items: [{ listingId: "fx-clockwork-rex", quantity: 1 }], rationale: "Wind-up T-rex." });
    const b = await call("propose_cart", { items: [{ listingId: "fx-dig-kit", quantity: 1 }], rationale: "Fossil dig." });
    expect(a).toMatchObject({ decision: "within", optionId: "opt-1", optionsSoFar: 1 });
    expect(b).toMatchObject({ decision: "within", optionId: "opt-2", optionsSoFar: 2 });
    expect(s.options.map((o) => [o.id, o.rank, o.rationale])).toEqual([
      ["opt-1", 1, "Wind-up T-rex."],
      ["opt-2", 2, "Fossil dig."],
    ]);
    expect(s.options[1].proposal.amount).toEqual({ currency: "USD", value: "21.40" });
    expect(s.cart?.proposal.amount).toEqual({ currency: "USD", value: "42.18" });
  });

  it("records an OUTSIDE proposal as ruled out with its clause ids, never as an option", async () => {
    const { call, s } = await session();
    await call("search_products", { query: "dinosaur gift" });
    const res = await call("propose_cart", { items: [{ listingId: "fx-roar-plush", quantity: 1 }], rationale: "" });
    expect(res).toMatchObject({ decision: "outside", optionId: null, optionsSoFar: 0 });
    expect(s.options).toEqual([]);
    expect(s.cart).toBeNull();
    expect(s.ruledOut).toHaveLength(1);
    expect(s.ruledOut[0].clauseIds).toContain("c5");
    expect(s.ruledOut[0].title).toMatch(/Roar/);
  });

  it("refuses a duplicate cart without using a proposal", async () => {
    const { call, s } = await session();
    await call("search_products", { query: "dinosaur gift" });
    await call("propose_cart", { items: [{ listingId: "fx-clockwork-rex", quantity: 1 }], rationale: "" });
    const dupe = await call("propose_cart", { items: [{ listingId: "fx-clockwork-rex", quantity: 1 }], rationale: "again" });
    expect(dupe.error).toMatch(/Same cart as option 1/);
    expect(s.proposals).toBe(1);
    expect(s.options).toHaveLength(1);
  });

  it("sorts an ASK option after a WITHIN one", async () => {
    const { rt, call, s } = await session();
    const json = rt.ai.json.bind(rt.ai);
    vi.spyOn(rt.ai, "json").mockImplementation(async (req) => {
      const out = await json(req);
      const text = String((req as { prompt?: string }).prompt ?? "");
      return req.label === "extract-facts" && /Clockwork/.test(text) ? ({ ...(out as object), deliveryEstimate: null } as typeof out) : out;
    });
    await call("search_products", { query: "dinosaur gift" });
    const rex = await call("propose_cart", { items: [{ listingId: "fx-clockwork-rex", quantity: 1 }], rationale: "" });
    const dig = await call("propose_cart", { items: [{ listingId: "fx-dig-kit", quantity: 1 }], rationale: "" });
    expect(rex.decision).toBe("ask");
    expect(dig.decision).toBe("within");
    expect(s.options.map((o) => [o.id, o.rank, o.verdict.decision])).toEqual([
      ["opt-2", 1, "within"],
      ["opt-1", 2, "ask"],
    ]);
    expect(s.cart?.verdict.decision).toBe("within");
  });

  it("counts the 4-pack as four units against c2", async () => {
    const { call } = await session();
    await call("search_products", { query: "raptor figures dinosaur" });
    const res = await call("propose_cart", { items: [{ listingId: "fx-pocket-raptors", quantity: 1 }], rationale: "" });
    expect((res.violations as { clauseId: string }[]).map((v) => v.clauseId)).toContain("c2");
  });
});

describe("affiliate links", () => {
  it("attaches the demo account's link to Clockwork Rex and carries it onto the cart line", async () => {
    const { s, call } = await session(false, true);
    await call("search_products", { query: "dinosaur gift" });
    await call("propose_cart", { items: [{ listingId: "fx-clockwork-rex", quantity: 1 }], rationale: "" });
    const line = s.options[0].lines[0];
    expect(line.affiliate?.url).toBe("https://dinodepot.example/p/fx-clockwork-rex?ref=permission-slip-demo");
    expect(line.affiliate?.url.endsWith(`?ref=${DEMO_AFFILIATE_ID}`)).toBe(true);
    expect(line.url).toBe("https://dinodepot.example/p/fx-clockwork-rex");
  });

  it("never puts the tracking id, the account id or ref= in a tool result", async () => {
    const { s, call, account } = await session(true, true);
    const results = [
      await call("search_products", { query: "dinosaur gift" }),
      await call("inspect_listing", { listingId: "fx-clockwork-rex" }),
      await call("inspect_listing", { listingId: "rt-dino-mega-bundle" }),
      await call("propose_cart", { items: [{ listingId: "fx-clockwork-rex", quantity: 1 }], rationale: "" }),
      await call("propose_cart", { items: [{ listingId: "fx-dig-kit", quantity: 1 }], rationale: "" }),
      await call("propose_cart", { items: [{ listingId: "fx-dig-kit", quantity: 1 }], rationale: "" }),
    ];
    expect(s.options).toHaveLength(2);
    const text = JSON.stringify(results);
    expect(text).not.toContain(DEMO_AFFILIATE_ID);
    expect(text).not.toContain(account!.id);
    expect(text).not.toContain("ref=");
    expect(text).not.toContain("dinodepot.example/p/");
  });

  it("gives the same verdict with and without the account", async () => {
    const run = async (withAffiliate: boolean) => {
      const { call } = await session(false, withAffiliate);
      await call("search_products", { query: "dinosaur gift" });
      const out = [];
      for (const id of ["fx-clockwork-rex", "fx-roar-plush", "fx-dig-kit"]) {
        const r = await call("propose_cart", { items: [{ listingId: id, quantity: 1 }], rationale: "" });
        out.push({ decision: r.decision, violations: r.violations, unknowns: r.unknowns });
      }
      return out;
    };
    expect(await run(true)).toEqual(await run(false));
  });

  it("notes affiliate links in the search ledger and leaves lines unlinked without an account", async () => {
    const withAcc = await session(false, true);
    await withAcc.call("search_products", { query: "dinosaur gift" });
    const ev = events(withAcc.rt, withAcc.slip.id, "shop.search")[0];
    expect(String((ev.data as { message: string }).message)).toMatch(/with affiliate links/);
    const none = await session();
    await none.call("search_products", { query: "dinosaur gift" });
    await none.call("propose_cart", { items: [{ listingId: "fx-clockwork-rex", quantity: 1 }], rationale: "" });
    expect(none.s.options[0].lines[0].affiliate).toBeNull();
  });
});
