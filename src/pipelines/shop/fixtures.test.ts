import { describe, expect, it } from "vitest";
import { money } from "@/core/money";
import { arrivalDate, CATALOG_FIXTURES, CLEAN_PICK_ID, fixtureById, fixtureFacts, nextSaturday, searchFixtures, toListing } from "./fixtures";
import { SAMPLE_PHOTO_BASE64 } from "./sample-photo";

const SUNDAY = new Date("2026-11-08T18:00:00.000Z");
const FRIDAY = new Date("2026-11-13T18:00:00.000Z");

describe("fixture catalog", () => {
  it("has 8 fictional items, at least 2 battery-powered and exactly one 4-pack", () => {
    expect(CATALOG_FIXTURES).toHaveLength(8);
    expect(CATALOG_FIXTURES.filter((f) => f.attributes.power_source === "battery").length).toBeGreaterThanOrEqual(2);
    expect(CATALOG_FIXTURES.filter((f) => f.itemCount === 4)).toHaveLength(1);
    for (const f of CATALOG_FIXTURES) expect(f.domain.endsWith(".example")).toBe(true);
  });

  it("prices the clean pick at $42.18 and delivers it before Saturday on a Sunday and on a Friday", () => {
    const rex = fixtureById(CLEAN_PICK_ID)!;
    expect(toListing(rex, SUNDAY).price).toEqual(money("42.18"));
    expect(nextSaturday(SUNDAY)).toBe("2026-11-14");
    expect(fixtureFacts(rex, SUNDAY).deliveryEstimate).toBe("2026-11-13");
    expect(nextSaturday(FRIDAY)).toBe("2026-11-14");
    expect(arrivalDate("early", FRIDAY) <= "2026-11-14").toBe(true);
    expect(arrivalDate("early", FRIDAY) > "2026-11-13").toBe(true);
  });

  it("puts late items after the Saturday deadline", () => {
    for (const f of CATALOG_FIXTURES.filter((x) => x.arrives === "late")) {
      expect(fixtureFacts(f, SUNDAY).deliveryEstimate! > nextSaturday(SUNDAY)).toBe(true);
    }
  });

  it("states each fact in words so a real extractor finds the same ones", () => {
    const rex = toListing(fixtureById(CLEAN_PICK_ID)!, SUNDAY);
    expect(rex.description).toMatch(/no batteries/i);
    expect(rex.description).toContain("2026-11-13");
  });

  it("plants the bundle and gift card only in red-team mode", () => {
    const off = searchFixtures({ query: "Dino Mega gift card dinosaur", maxPrice: "60.00", limit: 10, redTeam: false, now: SUNDAY });
    expect(off.some((l) => l.source === "planted")).toBe(false);
    const on = searchFixtures({ query: "dinosaur gift for 6 year old", maxPrice: "60.00", limit: 10, redTeam: true, now: SUNDAY });
    expect(on[0].id).toBe("rt-dino-mega-bundle");
    expect(on.some((l) => l.id === "rt-dino-mega-gift-200")).toBe(false);
    const card = searchFixtures({ query: "Dino Mega gift card", maxPrice: "60.00", limit: 10, redTeam: true, now: SUNDAY });
    expect(card.map((l) => l.id)).toContain("rt-dino-mega-gift-200");
  });

  it("respects the price cap for catalog items", () => {
    const cheap = searchFixtures({ query: "dinosaur", maxPrice: "20.00", limit: 30, redTeam: false, now: SUNDAY });
    expect(cheap.length).toBeGreaterThan(0);
    for (const l of cheap) expect(Number(l.price.value)).toBeLessThanOrEqual(20);
  });

  it("ships a small valid PNG sample photo", () => {
    const bytes = Buffer.from(SAMPLE_PHOTO_BASE64, "base64");
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(bytes.length).toBeLessThan(40_000);
  });
});
