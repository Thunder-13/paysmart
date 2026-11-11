import { describe, expect, it } from "vitest";
import { toCents } from "@/core/money";
import { createTestRuntime } from "@/core/testing";
import { contentOf, ensureCatalog, parsePublisherEmails, publishersOf, readCatalog, registerContent, SEED_CONTENT } from "./catalog";
import { tollBooth } from "./gateway";
import { gatewayDeps } from "./test-helpers";
import type { QuoteBody } from "./types";

function freshRt() {
  return createTestRuntime();
}

describe("catalog", () => {
  it("seed has 3 publishers, 6 articles, at least 3 prices, one above $0.05", () => {
    const rt = freshRt();
    ensureCatalog(rt.store);
    const { publishers, content } = readCatalog(rt.store);
    expect(publishers).toHaveLength(3);
    for (const p of publishers) expect(p.email).toContain("@");
    expect(content).toHaveLength(6);
    expect(new Set(content.map((c) => c.publisherId)).size).toBe(3);
    const prices = new Set(content.map((c) => c.price.value));
    expect(prices.size).toBeGreaterThanOrEqual(3);
    expect(content.some((c) => toCents(c.price) > 5)).toBe(true);
    for (const c of content) expect(c.body.length).toBeGreaterThan(400);
  });

  it("seeding twice leaves 3 publishers and 6 articles unchanged", () => {
    const rt = freshRt();
    ensureCatalog(rt.store);
    const first = readCatalog(rt.store);
    ensureCatalog(rt.store);
    const second = readCatalog(rt.store);
    expect(second).toEqual(first);
    expect(second.content.map((c) => [c.id, c.price.value])).toEqual(SEED_CONTENT.map((c) => [c.id, c.price.value]));
  });

  it("sandbox emails replace the seed payout emails in order", () => {
    const rt = freshRt();
    const emails = parsePublisherEmails(" a@sandbox.test, b@sandbox.test ,bad, c@sandbox.test");
    expect(emails).toEqual(["a@sandbox.test", "b@sandbox.test", "c@sandbox.test"]);
    ensureCatalog(rt.store, { emails });
    expect(publishersOf(rt.store).get("quarry-street")?.email).toBe("b@sandbox.test");
  });

  it("registers an article that the booth then quotes", () => {
    const rt = freshRt();
    ensureCatalog(rt.store);
    const res = registerContent(
      rt.store,
      { publisher: { name: "Harbor Weekly", email: "harbor@example.com" }, title: "Tide tables", body: "High tide is at noon.", price: "0.03" },
      rt.now(),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.gatewayPath).toBe(`/api/p/toll-road/content/${res.content.id}`);
    const quote = tollBooth(gatewayDeps(rt), res.content.id, null);
    expect(quote.status).toBe(402);
    expect((quote.body as QuoteBody).price).toBe("0.03");
  });

  it("rejects price 0, 2.50 and 0.035", () => {
    const rt = freshRt();
    ensureCatalog(rt.store);
    for (const price of ["0", "2.50", "0.035", "0.00"]) {
      const res = registerContent(
        rt.store,
        { publisher: { name: "P", email: "p@example.com" }, title: "T", body: "B", price },
        rt.now(),
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.errors.map((e) => e.field)).toContain("price");
    }
    expect(contentOf(rt.store).list()).toHaveLength(6);
  });

  it("rejects a bad email and empty title or body", () => {
    const rt = freshRt();
    const res = registerContent(rt.store, { publisher: { name: "P", email: "nope" }, title: " ", body: "", price: "0.03" }, rt.now());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.map((e) => e.field).sort()).toEqual(["body", "publisher.email", "title"]);
  });

  it("second registration with the same email reuses the publisher", () => {
    const rt = freshRt();
    const input = (title: string) => ({ publisher: { name: "Harbor", email: "Harbor@Example.com" }, title, body: "Text.", price: "0.01" });
    const a = registerContent(rt.store, input("One"), rt.now());
    const b = registerContent(rt.store, { ...input("Two"), publisher: { name: "Harbor", email: "harbor@example.com" } }, rt.now());
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(b.publisher.id).toBe(a.publisher.id);
    expect(publishersOf(rt.store).list()).toHaveLength(1);
  });
});
