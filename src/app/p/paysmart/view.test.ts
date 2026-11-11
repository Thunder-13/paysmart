import { describe, expect, it } from "vitest";
import type { Clause, LedgerEvent, Run } from "@/core/contracts";
import {
  ChooseSignalSchema,
  ClarifySignalSchema,
  DeliverySignalSchema,
  ConfirmRefundSignalSchema,
  PAYSMART_DEMO_ASK,
  SCREEN_IDS,
  type ProductCard,
  type ScreenResult,
} from "@/pipelines/paysmart/types";
import {
  OUTCOME_WORDS,
  activityLines,
  activityHeading,
  askViaFor,
  buildLanes,
  countsLine,
  pendingLine,
  passedScreenNeed,
  requestScreenView,
  screenedGroupTitle,
  sourceShortName,
  sourceName,
  budgetOf,
  buildAttestations,
  chooseData,
  clausesChanged,
  editClauses,
  evidenceHref,
  filterCounts,
  filterProducts,
  funnelSteps,
  holdLine,
  initialAsk,
  payLabel,
  plain,
  receiptRows,
  retailerLink,
  screenRow,
  screenText,
  signals,
  sourceTag,
  unknownFields,
  waitStage,
} from "./view";

const usd = (value: string) => ({ currency: "USD", value });

function product(over: Partial<ProductCard>): ProductCard {
  return {
    listingId: "l1",
    need: null,
    title: "Toy",
    price: usd("10.00"),
    domain: "shop.example",
    url: "https://shop.example/toy",
    source: "fixture",
    affiliate: null,
    facts: null,
    screens: [],
    status: "eligible",
    ...over,
  };
}

const clauses = [
  { id: "c1", kind: "budget_max", label: "Spend at most $60.00", amount: usd("60.00") },
  { id: "c2", kind: "quantity_max", label: "At most 2 items", max: 2 },
  { id: "c3", kind: "expires_at", label: "Expires soon", at: "2026-12-01T00:00:00Z" },
] as unknown as Clause[];

function run(over: Partial<Run>): Run {
  return { id: "r", pipeline: "paysmart", slipId: "s1", status: "waiting", step: "choose", state: {}, wait: null, error: null, createdAt: "", updatedAt: "", ...over };
}

describe("paysmart view", () => {
  it("prefills from ?ask= and falls back to the demo ask", () => {
    expect(initialAsk(undefined)).toBe(PAYSMART_DEMO_ASK);
    expect(initialAsk("  ")).toBe(PAYSMART_DEMO_ASK);
    expect(initialAsk(["a"])).toBe(PAYSMART_DEMO_ASK);
    expect(initialAsk(" a mug under $20 ")).toBe("a mug under $20");
    expect(initialAsk("x".repeat(900))).toHaveLength(600);
  });

  it("reads the wait stage only from known stages while waiting", () => {
    expect(waitStage(run({ wait: { kind: "user_confirm", message: "m", data: { stage: "choose" } } }))).toBe("choose");
    expect(waitStage(run({ wait: { kind: "user_confirm", message: "m", data: { stage: "nope" } } }))).toBeNull();
    expect(waitStage(run({ status: "running", wait: null }))).toBeNull();
    expect(waitStage(null)).toBeNull();
  });

  it("reads choose data defensively", () => {
    expect(chooseData({})).toEqual({ options: [], ruledOut: [], funnel: null, clauses: null, limit: null, problem: null });
    const d = chooseData({ options: [{ id: "opt-1" }], limit: usd("60.00"), problem: "Pick an option or decline." });
    expect(d.options).toHaveLength(1);
    expect(d.limit).toEqual(usd("60.00"));
    expect(d.problem).toBe("Pick an option or decline.");
  });

  it("names every screen source and writes no dash glyphs", () => {
    const r: ScreenResult = {
      screen: "seller",
      status: "fail",
      reason: "Seller asks for Friends and Family — skip fees",
      clauseIds: [],
      quote: "pay me by friends and family",
    };
    const row = screenRow(r);
    expect(row.source).toBe("Second Look: scam tactics in seller text");
    expect(row.statusWord).toBe("fail");
    expect(screenText(r)).toContain("Second Look: scam tactics in seller text. fail: Seller asks for Friends and Family, skip fees");
    expect(screenText(r)).toContain('Quote: "pay me by friends and family"');
    expect(screenText(r)).not.toMatch(/[–—]/);
    for (const id of SCREEN_IDS) expect(screenRow({ screen: id, status: "pass", reason: "ok", clauseIds: [], quote: null }).source).not.toBe(id);
    expect(plain("a – b")).toBe("a, b");
  });

  it("filters and counts products", () => {
    const ps = [
      product({ listingId: "a", status: "eligible" }),
      product({ listingId: "b", status: "ruled_out" }),
      product({ listingId: "c", status: "needs_you" }),
      product({ listingId: "d", status: "unchecked" }),
      product({ listingId: "e", status: "eligible" }),
    ];
    expect(filterCounts(ps)).toEqual({ all: 5, eligible: 2, ruled_out: 1, needs_you: 1 });
    expect(filterProducts(ps, "all")).toHaveLength(5);
    expect(filterProducts(ps, "eligible").map((p) => p.listingId)).toEqual(["a", "e"]);
    expect(filterProducts(ps, "ruled_out").map((p) => p.listingId)).toEqual(["b"]);
    expect(filterProducts(ps, "needs_you").map((p) => p.listingId)).toEqual(["c"]);
  });

  it("lists the funnel in the order the person reads it", () => {
    const steps = funnelSteps({ found: 9, clean: 8, trusted: 7, withinSlip: 5, inCarts: 3 });
    expect(steps.map((s) => s.label)).toEqual(["Found", "Clean", "Trusted sellers", "Within your slip", "In carts"]);
    expect(steps.map((s) => s.value)).toEqual([9, 8, 7, 5, 3]);
  });

  it("tags planted and marketplace listings", () => {
    expect(sourceTag("planted", "evil.example")).toEqual({ label: "Planted", tone: "red" });
    expect(sourceTag("fixture", "marketplace.example")?.label).toBe("Marketplace seller (sample)");
    expect(sourceTag("fixture", "toys.example")?.label).toBe("Sample data");
    expect(sourceTag("channel3", "toys.example")).toBeNull();
  });

  it("marks affiliate links rel=sponsored and links only live listings", () => {
    const aff = { url: "https://aff.example/x" } as unknown as ProductCard["affiliate"];
    const live = retailerLink({ url: "https://shop.example/a", affiliate: aff, source: "channel3" });
    expect(live).toMatchObject({ href: "https://aff.example/x", affiliate: true });
    expect(live?.rel).toContain("sponsored");
    const plainLive = retailerLink({ url: "https://shop.example/a", affiliate: null, source: "channel3" });
    expect(plainLive?.rel).toBe("noopener noreferrer");
    const sample = retailerLink({ url: "https://shop.example/a", affiliate: null, source: "fixture" });
    expect(sample).toMatchObject({ href: null, text: "https://shop.example/a" });
    expect(retailerLink({ url: "javascript:alert(1)", affiliate: null, source: "channel3" })).toBeNull();
    expect(retailerLink({ url: null, affiliate: null, source: "channel3" })).toBeNull();
  });

  it("writes the pay button, hold line and receipt rows from money", () => {
    expect(payLabel(usd("42.18"))).toBe("Pay $42.18 with PayPal");
    expect(holdLine(usd("42.18"))).toBe("PayPal will hold $42.18, the cart you chose, not your full limit.");
    const rows = receiptRows({ limit: usd("60.00"), held: usd("42.18"), captured: usd("42.18"), released: usd("0.00"), refunded: usd("0.00") });
    expect(rows.map((r) => r.label)).toEqual(["Your limit", "PayPal held", "Captured", "Released", "Refunded"]);
    expect(rows[1].money.value).toBe("42.18");
    expect(evidenceHref("slip_1")).toBe("/api/slips/slip_1/evidence");
  });

  it("has outcome words for every outcome", () => {
    for (const k of ["paid", "refunded", "cancelled", "no_options", "blocked", "capture_failed", "handed_off"] as const) {
      expect(OUTCOME_WORDS[k]).toBeTruthy();
    }
  });

  it("builds attestations with Shop's coercions", () => {
    const att = buildAttestations(["itemCount", "inStock", "deliveryEstimate", "category"], { itemCount: "4", inStock: "yes", deliveryEstimate: "2026-11-14", category: "" });
    expect(att).toEqual([
      { field: "itemCount", value: 4 },
      { field: "inStock", value: true },
      { field: "deliveryEstimate", value: "2026-11-14" },
    ]);
  });

  it("collects unknown fields once", () => {
    const opt = { verdict: { unknowns: [{ field: "inStock" }, { field: "inStock" }, { field: "itemCount" }] } } as never;
    expect(unknownFields(opt)).toEqual(["inStock", "itemCount"]);
    expect(unknownFields(undefined)).toEqual([]);
  });

  it("edits the limit and drops only removable clauses", () => {
    expect(budgetOf(clauses)).toBe("60.00");
    const r = editClauses(clauses, "45", ["c2", "c3", "c1"]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.clauses.map((c) => c.id)).toEqual(["c1", "c3"]);
      expect(r.clauses[0]).toMatchObject({ kind: "budget_max", amount: { value: "45.00" } });
      expect(clausesChanged(clauses, r.clauses)).toBe(true);
    }
    const same = editClauses(clauses, "60", []);
    expect(same.ok && clausesChanged(clauses, same.clauses)).toBe(false);
    expect(editClauses(clauses, "sixty", [])).toMatchObject({ ok: false });
  });

  it("builds signals that pass the frozen schemas", () => {
    expect(ClarifySignalSchema.safeParse(signals.clarifyAnswer("  a mug  ")).success).toBe(true);
    expect(signals.clarifyAnswer("   ")).toBeNull();
    expect(signals.clarifyAnswer("x".repeat(400))?.answer).toHaveLength(300);
    expect(ClarifySignalSchema.safeParse(signals.clarifyCancel()).success).toBe(true);

    const pay = signals.choose("opt-2", "keyboard", []);
    expect(pay).toEqual({ approved: true, optionId: "opt-2", via: "keyboard" });
    expect(ChooseSignalSchema.safeParse(pay).success).toBe(true);
    const asked = signals.choose("opt-3", "click", [{ field: "inStock", value: true }]);
    expect(asked.attestations).toHaveLength(1);
    expect(ChooseSignalSchema.safeParse(asked).success).toBe(true);
    expect(signals.decline()).toEqual({ approved: false });
    expect(ChooseSignalSchema.safeParse(signals.decline()).success).toBe(true);

    const re = signals.recheck(clauses);
    expect(re).not.toHaveProperty("optionId");
    expect(re.approved).toBe(true);
    expect(ChooseSignalSchema.safeParse(re).success).toBe(true);

    expect(DeliverySignalSchema.safeParse(signals.deliveryPhoto({ ref: "b1", contentType: "image/png" })).success).toBe(true);
    expect(signals.deliverySample()).toEqual({ sample: true });
    expect(signals.deliverySkip()).toEqual({ skip: true });
    expect(ConfirmRefundSignalSchema.safeParse(signals.refund(true)).success).toBe(true);
  });

  it("turns ledger events into plain activity lines without run bookkeeping", () => {
    const ev = (seq: number, type: string, data: unknown): LedgerEvent =>
      ({ seq, slipId: "s1", type, actor: "agent", data, at: "2026-11-11T00:00:00Z" }) as unknown as LedgerEvent;
    const lines = activityLines([
      ev(1, "run.step", { step: "intake" }),
      ev(2, "paysmart.search", { message: "Searched dinosaur gift — 6 results" }),
      ev(3, "run.waiting", { wait: { message: "x" } }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].title).toBe("Searched dinosaur gift, 6 results");
  });

  it("groups products into lanes by need, in listingIds order, splitting dropped", () => {
    const search = (id: string, need: string, listingIds: string[]) => ({
      id, need, query: need, source: "fixtures" as const, maxPrice: usd("60.00"), at: "", found: listingIds.length, ruledOut: 0, shown: 0, inspected: 0, listingIds,
    });
    const searches = [search("s-1", "gift", ["g3", "g1", "g2"]), search("s-2", "card", ["c1"])];
    const ps = [
      product({ listingId: "g1", need: "gift", status: "eligible" }),
      product({ listingId: "g2", need: "gift", status: "ruled_out" }),
      product({ listingId: "g3", need: "gift", status: "needs_you" }),
      product({ listingId: "c1", need: "card", status: "eligible" }),
      product({ listingId: "x1", need: null, status: "unchecked" }),
    ];
    const all = buildLanes(["gift", "card", "wrapping"], searches, ps, "all");
    expect(all.map((l) => l.key)).toEqual(["s-1", "s-2", "pending-wrapping", "other"]);
    expect(all[0].products.map((p) => p.listingId)).toEqual(["g3", "g1"]);
    expect(all[0].dropped.map((p) => p.listingId)).toEqual(["g2"]);
    expect(all[0].droppedOpen).toBe(false);
    expect(all[1].products.map((p) => p.listingId)).toEqual(["c1"]);
    expect(all[2]).toMatchObject({ pending: true, need: "wrapping", products: [] });
    expect(all[3].products.map((p) => p.listingId)).toEqual(["x1"]);

    const eligible = buildLanes(["gift", "card"], searches, ps, "eligible");
    expect(eligible[0].products.map((p) => p.listingId)).toEqual(["g1"]);
    expect(eligible[0].dropped).toEqual([]);
    const out = buildLanes(["gift", "card"], searches, ps, "ruled_out");
    expect(out[0].products).toEqual([]);
    expect(out[0].dropped.map((p) => p.listingId)).toEqual(["g2"]);
    expect(out[0].droppedOpen).toBe(true);
  });

  it("gives each product to one lane when two searches share a need", () => {
    const s = (id: string) => ({ id, need: "gift", query: "q", source: "channel3" as const, maxPrice: usd("1.00"), at: "", found: 1, ruledOut: 0, shown: 1, inspected: 1, listingIds: ["a"] });
    const lanes = buildLanes(["gift"], [s("s-1"), s("s-2")], [product({ listingId: "a", need: "gift" })], "all");
    expect(lanes[0].products).toHaveLength(1);
    expect(lanes[1].products).toHaveLength(0);
  });

  it("writes lane captions", () => {
    expect(countsLine({ found: 12, ruledOut: 2, shown: 10, inspected: 5 })).toBe("12 found · 2 dropped by screens · 10 shown · 5 checked against your slip");
    expect(sourceName("channel3")).toBe("Channel3");
    expect(sourceName("fixtures")).toBe("offline catalog");
    expect(pendingLine("a birthday card")).toBe("Searching for a birthday card…");
    expect(activityHeading("assemble")).toBe("The agent is building carts from these products");
    expect(activityHeading("discover")).toBe("Agent activity");
  });

  it("marks an ask voice only while the box holds exactly the dictation", () => {
    expect(askViaFor(null, "a mug")).toBe("typed");
    expect(askViaFor("a mug under 20", "a mug under 20")).toBe("voice");
    expect(askViaFor("a mug under 20", "  a mug under 20 ")).toBe("voice");
    expect(askViaFor("a mug under 20", "a mug under 25")).toBe("typed");
    expect(askViaFor("", "")).toBe("typed");
  });
  describe("activity grouping", () => {
    const ev = (seq: number, type: string, data: unknown, actor = "system"): LedgerEvent =>
      ({ seq, slipId: "s1", type, actor, data, at: "2026-11-11T00:00:00Z" }) as unknown as LedgerEvent;
    const pass = (seq: number, need: string, title = `Toy ${seq}`) =>
      ev(seq, "paysmart.listing_screened", { need, title, screens: [{ screen: "integrity", status: "pass" }, { screen: "seller", status: "pass" }], message: `${title}: passed the integrity and seller screens` });
    const fail = (seq: number, need: string) =>
      ev(seq, "paysmart.listing_screened", { need, title: "Bad", screens: [{ screen: "integrity", status: "fail" }], message: "Bad: dropped. hidden instructions" });

    it("collapses passed listings to one line per need, at the first listing's place", () => {
      const lines = activityLines([
        ev(1, "paysmart.routed", { message: "Understood as buy" }),
        ...[2, 3, 4].map((n) => pass(n, "dinosaur gift")),
        ev(5, "paysmart.search", { message: "Searched the sample catalog for dino" }),
        pass(6, "birthday card"),
      ]);
      expect(lines.map((l) => l.title)).toEqual([
        "Understood as buy",
        "dinosaur gift: 3 listings passed the screens",
        "Searched the sample catalog for dino",
        "birthday card: 1 listing passed the screens",
      ]);
      expect(new Set(lines.map((l) => l.key)).size).toBe(4);
    });

    it("keeps drops, agent steps and payment events as their own lines", () => {
      const lines = activityLines([
        pass(1, "gift"),
        fail(2, "gift"),
        pass(3, "gift"),
        ev(4, "agent.step", { step: { kind: "message", text: "Building carts" } }, "agent"),
        ev(5, "rail.captured", { amount: { currency: "USD", value: "20.00" } }, "rail"),
      ]);
      expect(lines.map((l) => l.title)).toEqual(["gift: 2 listings passed the screens", "Bad: dropped. hidden instructions", "Agent", "Captured $20.00"]);
    });

    it("leaves a passed listing with no need on its own line", () => {
      expect(passedScreenNeed(ev(1, "paysmart.listing_screened", { screens: [] }))).toBeNull();
      expect(passedScreenNeed(ev(1, "paysmart.search", { need: "gift" }))).toBeNull();
      expect(passedScreenNeed(fail(1, "gift"))).toBeNull();
      expect(passedScreenNeed(pass(1, " gift "))).toBe("gift");
      expect(screenedGroupTitle("gift", 1)).toBe("gift: 1 listing passed the screens");
    });
  });

  describe("request screen summary", () => {
    const r = (screen: ScreenResult["screen"], status: ScreenResult["status"], reason: string): ScreenResult => ({ screen, status, reason, clauseIds: [], quote: null });

    it("shows one heading with a pass count and rows with only their reason", () => {
      const v = requestScreenView([
        r("request", "pass", "The ask became a valid slip"),
        r("request", "pass", "Limit $60.00 is within the $500.00 cap"),
        r("request", "pass", "Second Look found no payment red flags in your ask"),
      ]);
      expect(v.heading).toBe("Your ask was checked first: 3 of 3 passed");
      expect(v.allPassed).toBe(true);
      expect(v.openByDefault).toBe(false);
      expect(v.rows.map((x) => x.source)).toEqual([null, null, null]);
      expect(v.rows[2].reason).toBe("Second Look found no payment red flags in your ask");
    });

    it("names a source only when it differs, and opens when something failed", () => {
      const v = requestScreenView([
        r("request", "pass", "ok"),
        r("request", "pass", "ok too"),
        r("seller", "fail", "Asks for Friends and Family"),
      ]);
      expect(v.heading).toBe("Your ask was checked first: 2 of 3 passed");
      expect(v.allPassed).toBe(false);
      expect(v.openByDefault).toBe(true);
      expect(v.rows.map((x) => x.source)).toEqual([null, null, "Second Look"]);
    });

    it("strips dashes from reasons and handles an empty list", () => {
      expect(requestScreenView([r("request", "pass", "ok \u2014 fine")]).rows[0].reason).toBe("ok, fine");
      const empty = requestScreenView([]);
      expect(empty).toMatchObject({ passed: 0, total: 0, allPassed: false, rows: [] });
      expect(sourceShortName("Permission Slip quarantine: hidden instructions")).toBe("Permission Slip quarantine");
      expect(sourceShortName("No colon")).toBe("No colon");
    });
  });
});
