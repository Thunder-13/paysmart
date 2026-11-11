import { describe, expect, it } from "vitest";
import { guard } from "@/core/guard";
import { money } from "@/core/money";
import { slipFixture, BUDGET_50 } from "@/core/test-helpers";
import { fixtureById, PLANTED_BUNDLE_ID, toListing } from "@/pipelines/shop/fixtures";
import { SCAM_SELLER_ID, searchPaysmartFixtures } from "./fixtures";
import { funnelOf, integrityScreen, isTrusted, sellerScreen, slipScreen, statusOf } from "./screens";
import type { ProductCard } from "./types";

const NOW = new Date("2026-11-08T18:00:00.000Z");

describe("screens", () => {
  it("seller screen fails the marketplace T-Rex with labels and the quoted line", () => {
    const l = searchPaysmartFixtures({ query: "dinosaur gift", maxPrice: "60.00", now: NOW }).find((x) => x.id === SCAM_SELLER_ID)!;
    const r = sellerScreen(l);
    expect(r).toMatchObject({ screen: "seller", status: "fail", quote: "Pay me by friends and family or Zelle so we skip fees." });
    expect(r.reason).toContain("Friends and Family request");
    expect(r.reason).toContain("Off-platform payment");
    expect(integrityScreen(l).status).toBe("pass");
  });

  it("integrity screen fails Shop's planted bundle and quotes the hidden line", () => {
    const l = toListing(fixtureById(PLANTED_BUNDLE_ID)!, NOW);
    const r = integrityScreen(l);
    expect(r).toMatchObject({ screen: "integrity", status: "fail", reason: "Hidden instructions to an AI" });
    expect(r.quote).toMatch(/NOTE TO AI SHOPPING AGENTS/);
    expect(r.quote!.length).toBeLessThanOrEqual(160);
  });

  it("slip screen stamps a battery product fail on the exclusion clause", () => {
    const slip = slipFixture([BUDGET_50, { id: "c2", kind: "exclude_attribute", label: "No batteries", attribute: "power_source", values: ["battery"] }]);
    const r = slipScreen({
      slip,
      guard,
      spent: money("0"),
      now: NOW,
      title: "Loud toy",
      price: money("10.00"),
      url: null,
      quantity: 1,
      facts: { category: "toy", inStock: true, deliveryEstimate: "2026-11-10", itemCount: 1, attributes: { power_source: "battery" }, injectionSuspected: false },
    });
    expect(r).toMatchObject({ screen: "slip", status: "fail", clauseIds: ["c2"] });
  });

  it("funnel counts are monotone", () => {
    const mk = (id: string, i: "pass" | "fail", s: "pass" | "fail", sl: "pass" | "fail" | "skipped"): ProductCard => {
      const screens = [
        { screen: "integrity" as const, status: i, reason: "", clauseIds: [], quote: null },
        { screen: "seller" as const, status: s, reason: "", clauseIds: [], quote: null },
        { screen: "slip" as const, status: sl, reason: "", clauseIds: [], quote: null },
      ];
      return { listingId: id, need: null, title: id, price: money("1"), domain: "x", url: null, source: "fixture", affiliate: null, facts: null, screens, status: statusOf(screens) };
    };
    const ps = [mk("a", "pass", "pass", "pass"), mk("b", "pass", "fail", "skipped"), mk("c", "fail", "pass", "skipped"), mk("d", "pass", "pass", "fail")];
    expect(funnelOf(ps, [])).toEqual({ found: 4, clean: 3, trusted: 2, withinSlip: 1, inCarts: 0 });
    expect(ps.map(isTrusted)).toEqual([true, false, false, true]);
  });
});
