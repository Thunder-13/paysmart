import { describe, expect, it } from "vitest";
import { detect } from "@/pipelines/second-look/detectors";
import { BATTERY_CARD_ID, CLEAN_CARD_ID, PAYSMART_FIXTURES, paysmartFactsFor, SCAM_SELLER_ID, searchPaysmartFixtures } from "./fixtures";

const NOW = new Date("2026-11-08T18:00:00.000Z");

describe("paysmart fixtures", () => {
  it("finds both cards for a birthday card query and prices them", () => {
    const hits = searchPaysmartFixtures({ query: "birthday card", maxPrice: "60.00", now: NOW });
    expect(hits.map((h) => [h.id, h.price.value])).toEqual([
      [CLEAN_CARD_ID, "4.99"],
      [BATTERY_CARD_ID, "6.50"],
    ]);
  });

  it("keeps the cards out of a dinosaur gift search", () => {
    const ids = searchPaysmartFixtures({ query: "dinosaur gift", maxPrice: "60.00", now: NOW }).map((h) => h.id);
    expect(ids).toEqual([SCAM_SELLER_ID]);
  });

  it("finds the marketplace T-Rex for a dinosaur gift query and respects the price cap", () => {
    expect(searchPaysmartFixtures({ query: "dinosaur gift", maxPrice: "60.00", now: NOW }).map((h) => h.id)).toContain(SCAM_SELLER_ID);
    expect(searchPaysmartFixtures({ query: "dinosaur gift", maxPrice: "30.00", now: NOW }).map((h) => h.id)).not.toContain(SCAM_SELLER_ID);
  });

  it("relabels the source when planted", () => {
    const [hit] = searchPaysmartFixtures({ query: "birthday card", maxPrice: "60.00", now: NOW, asPlanted: true });
    expect(hit.source).toBe("planted");
  });

  it("gives the clean card early delivery and no power, and the battery card battery power", () => {
    const clean = searchPaysmartFixtures({ query: "pop-up card", maxPrice: "60.00", now: NOW })[0];
    expect(paysmartFactsFor(clean, NOW)).toMatchObject({ category: "greeting_card", deliveryEstimate: "2026-11-13", attributes: { power_source: "none" } });
    const roar = searchPaysmartFixtures({ query: "roaring card", maxPrice: "60.00", now: NOW })[0];
    expect(paysmartFactsFor(roar, NOW).attributes.power_source).toBe("battery");
  });

  it("only the marketplace T-Rex trips the Second Look detectors", () => {
    const flagged = PAYSMART_FIXTURES.filter((f) => detect([{ source: "listing", text: `${f.title}\n${f.text}` }]).length > 0).map((f) => f.id);
    expect(flagged).toEqual([SCAM_SELLER_ID]);
  });
});
