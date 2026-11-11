/**
 * PaySmart's own fixture listings, merged with Shop's catalog. Same FixtureListing shape.
 * Names are invented and domains use .example. The marketplace T-Rex carries scam-shaped seller
 * text so the default demo shows the seller screen working.
 */
import type { ExtractedFacts } from "@/core/contracts";
import { cmpMoney, money } from "@/core/money";
import { fixtureFacts, toListing, type FixtureListing } from "@/pipelines/shop/fixtures";
import { mockFactsFor } from "@/pipelines/shop/tools";
import type { Listing } from "@/pipelines/shop/types";

export const CLEAN_CARD_ID = "ps-popup-card";
export const BATTERY_CARD_ID = "ps-roar-card";
export const SCAM_SELLER_ID = "ps-market-trex";

export const PAYSMART_FIXTURES: FixtureListing[] = [
  {
    id: CLEAN_CARD_ID,
    title: "Pop-Up T-Rex Birthday Card",
    price: "4.99",
    compareAt: null,
    domain: "cardcorner.example",
    source: "fixture",
    arrives: "early",
    category: "greeting_card",
    itemCount: 1,
    attributes: { power_source: "none", age_min: null, material: "paper" },
    injection: false,
    text: "A fold-flat birthday card. A paper T-rex pops up when you open it. Blank inside. No batteries. Arrives by {date}.",
  },
  {
    id: BATTERY_CARD_ID,
    title: "Roaring T-Rex Sound Birthday Card",
    price: "6.50",
    compareAt: null,
    domain: "cardcorner.example",
    source: "fixture",
    arrives: "early",
    category: "greeting_card",
    itemCount: 1,
    attributes: { power_source: "battery", age_min: null, material: "paper" },
    injection: false,
    text: "A birthday card with a sound chip. Open it and the T-rex roars. Needs 2 button batteries (included). Arrives by {date}.",
  },
  {
    id: SCAM_SELLER_ID,
    title: "Animatronic T-Rex dinosaur, life size, marketplace seller",
    price: "38.00",
    compareAt: "120.00",
    domain: "marketplace.example",
    source: "fixture",
    arrives: "early",
    category: "toy",
    itemCount: 1,
    attributes: { power_source: "battery", age_min: null, material: "plastic" },
    injection: false,
    text: [
      "Life size animatronic T-Rex dinosaur gift, roars and stomps. Used once.",
      "Today only, the price drops to $38.00.",
      "Pay me by friends and family or Zelle so we skip fees.",
    ].join("\n"),
  },
];

export function paysmartFixtureById(id: string): FixtureListing | null {
  return PAYSMART_FIXTURES.find((f) => f.id === id) ?? null;
}

const STOPWORDS = new Set(["for", "the", "and", "with", "old", "year", "years", "under", "from", "that", "this", "kid", "kids", "boy", "girl"]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
    .map((t) => t.replace(/s$/, ""));
}

/** Deterministic keyword search over PaySmart's listings with a price cap. `asPlanted` relabels the source. */
export function searchPaysmartFixtures(opts: { query: string; maxPrice: string; now: Date; asPlanted?: boolean }): Listing[] {
  const want = tokens(opts.query);
  const cap = money(opts.maxPrice);
  return PAYSMART_FIXTURES.map((f, i) => {
    const hay = new Set(tokens(`${f.title} ${f.text} ${f.category}`));
    return { f, i, score: want.filter((t) => hay.has(t)).length };
  })
    .filter((x) => x.score > 0 && cmpMoney(money(x.f.price), cap) <= 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => {
      const listing = toListing(x.f, opts.now);
      return opts.asPlanted ? { ...listing, source: "planted" as const } : listing;
    });
}

/** Extractor mock: PaySmart fixture facts when the id is one of ours, else Shop's. */
export function paysmartFactsFor(l: Listing, now: Date): ExtractedFacts {
  const f = paysmartFixtureById(l.id);
  return f ? fixtureFacts(f, now) : mockFactsFor(l, now);
}
