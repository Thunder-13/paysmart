import { describe, expect, it, vi } from "vitest";
import { money } from "@/core/money";
import { catalogSource, searchCatalog } from "./catalog";

const NOW = new Date("2026-11-08T18:00:00.000Z");

describe("catalog facade", () => {
  it("uses fixtures without a key and Channel3 with one", () => {
    expect(catalogSource(null)).toBe("fixtures");
    expect(catalogSource("  ")).toBe("fixtures");
    expect(catalogSource("key")).toBe("channel3");
  });

  it("plants red-team listings on top of live results", async () => {
    const f = vi.fn(async () =>
      Response.json({ products: [{ id: "a", title: "Live dino", offers: [{ url: "https://l.example/a", price: { price: 20, currency: "USD" }, availability: "InStock" }] }] }),
    );
    const res = await searchCatalog(
      { apiKey: "k", fetch: f as unknown as typeof fetch, redTeam: true, now: NOW },
      { query: "dino mega gift card", limit: 10, maxPrice: money("60.00") },
    );
    expect(res.source).toBe("channel3");
    expect(res.listings.map((l) => l.id)).toEqual(["rt-dino-mega-gift-200", "rt-dino-mega-bundle", "c3-a"]);
  });

  it("surfaces a Channel3 failure as an error instead of falling back to fixtures", async () => {
    const f = vi.fn(async () => new Response("nope", { status: 503 }));
    await expect(
      searchCatalog({ apiKey: "k", fetch: f as unknown as typeof fetch, redTeam: false, now: NOW }, { query: "dino", limit: 5, maxPrice: money("60.00") }),
    ).rejects.toThrow(/Channel3 search failed: HTTP 503/);
  });
});
