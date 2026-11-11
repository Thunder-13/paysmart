import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteStore } from "@/core/store/sqlite";
import { AffiliateInputError, AffiliateNotFoundError, affiliateRepo } from "./index";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function repo() {
  const store = createSqliteStore(":memory:");
  return affiliateRepo(store);
}

describe("affiliateRepo", () => {
  it("fills Amazon preset defaults", () => {
    const a = repo().create({ network: "amazon", trackingId: "leoshop-21" });
    expect(a.id).toMatch(/^aff_/);
    expect(a.params).toEqual({ tag: "{id}" });
    expect(a.domains).toContain("amazon.in");
    expect(a.label).toBe("Amazon Associates");
    expect(a).toMatchObject({ template: null, commissionBps: null, active: true });
  });

  it("rejects Instagram without params or template", () => {
    expect(() => repo().create({ network: "instagram", trackingId: "leo.gifts" })).toThrow(
      /Instagram needs a template or parameters from the owner's program/,
    );
    expect(() => repo().create({ network: "myntra", trackingId: "abc12" })).toThrow(AffiliateInputError);
  });

  it("accepts Instagram with a template, using the preset domain", () => {
    const a = repo().create({ network: "instagram", trackingId: "leo.gifts", template: "https://go.example/?to={url}&id={id}" });
    expect(a.domains).toEqual(["instagram.com"]);
    expect(a.params).toEqual({});
  });

  it("requires domains for generic", () => {
    expect(() => repo().create({ network: "generic", trackingId: "abc12", params: { ref: "{id}" } })).toThrow(/domain/);
  });

  it("rejects an http template and saves nothing", () => {
    const r = repo();
    expect(() => r.create({ network: "generic", trackingId: "abc12", domains: ["a.example"], template: "http://links.example/?u={url}" })).toThrow(
      /https/,
    );
    expect(r.list()).toEqual([]);
  });

  it("rejects a template without {url} and bad tracking ids and domains", () => {
    const r = repo();
    expect(() => r.create({ network: "generic", trackingId: "abc12", domains: ["a.example"], template: "https://links.example/" })).toThrow(/\{url\}/);
    expect(() => r.create({ network: "amazon", trackingId: "a b" })).toThrow(AffiliateInputError);
    expect(() => r.create({ network: "amazon", trackingId: "ok-21", domains: ["https://amazon.in/x"] })).toThrow(AffiliateInputError);
  });

  it("normalizes domains to lowercase", () => {
    const a = repo().create({ network: "generic", trackingId: "abc12", domains: [" Shop.Example "], params: { ref: "{id}" } });
    expect(a.domains).toEqual(["shop.example"]);
  });

  it("lists, gets, updates and removes", () => {
    let t = 0;
    const r = affiliateRepo(createSqliteStore(":memory:"), () => new Date(Date.UTC(2026, 0, 1, 0, 0, t++)));
    const a = r.create({ network: "amazon", trackingId: "leoshop-21" });
    const b = r.create({ network: "flipkart", trackingId: "leoflip", commissionBps: 300 });
    expect(r.list().map((x) => x.id)).toEqual([a.id, b.id]);
    expect(r.get(a.id)).toEqual(a);
    const up = r.update(a.id, { active: false, commissionBps: 400, trackingId: "newtag-21" });
    expect(up).toMatchObject({ active: false, commissionBps: 400, trackingId: "newtag-21", createdAt: a.createdAt });
    expect(up.updatedAt > a.updatedAt).toBe(true);
    expect(r.active().map((x) => x.id)).toEqual([b.id]);
    expect(() => r.update("aff_missing", { active: false })).toThrow(AffiliateNotFoundError);
    expect(() => r.update(b.id, { template: "http://x.example/{url}" })).toThrow(/https/);
    expect(r.remove(a.id)).toBe(true);
    expect(r.remove(a.id)).toBe(false);
    expect(r.list().map((x) => x.id)).toEqual([b.id]);
  });

  it("update cannot strip an Instagram account of its link", () => {
    const r = repo();
    const a = r.create({ network: "instagram", trackingId: "leo.gifts", params: { ref: "{id}" } });
    expect(() => r.update(a.id, { params: {} })).toThrow(/Instagram needs/);
  });

  it("records survive reopening a file-backed store", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aff-"));
    dirs.push(dir);
    const file = path.join(dir, "t.db");
    const s1 = createSqliteStore(file);
    const created = affiliateRepo(s1).create({ network: "amazon", trackingId: "leoshop-21" });
    s1.close();
    const s2 = createSqliteStore(file);
    expect(affiliateRepo(s2).list()).toEqual([created]);
    s2.close();
  });
});
