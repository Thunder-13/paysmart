import { describe, expect, it } from "vitest";
import { createSqliteStore } from "./sqlite";
import { ledgerHash } from "./canonical";
import { ledgerHashWeb, verifyChainWeb, webCryptoAvailable, type WebLedgerEvent } from "./browser-hash";

function chain(): WebLedgerEvent[] {
  let t = Date.parse("2026-11-08T12:00:00.000Z");
  const s = createSqliteStore(":memory:", { now: () => new Date((t += 1000)) });
  const slip = "slip_web";
  s.ledger.append(slip, "slip.created", "user", { budget: { currency: "USD", value: "60.00" }, clauses: [{ id: "c1", n: 1.5, big: 12345678901 }] });
  s.ledger.append(slip, "note", "agent", { message: "Café “naïve” 日本語 🦖", nothing: null, nested: { z: [1, null, { b: 2, a: "0.10" }], a: -0.5 } });
  s.ledger.append(slip, "rail.captured", "rail", { amount: { currency: "USD", value: "45.18" }, finalCapture: true, ids: [] });
  s.ledger.append(slip, "note", "system", { message: "tab\tquote\"back\\slash", count: 0, flag: false });
  s.ledger.append(slip, "guard.verdict", "guard", { verdict: { decision: "outside", violations: [{ clauseId: "c2", message: "Over the cap" }] } });
  s.ledger.append(slip, "run.done", "system", { total: { currency: "USD", value: "1000000.00" } });
  return s.ledger.list(slip);
}

describe("browser hash", () => {
  it("has Web Crypto under Node", () => {
    expect(webCryptoAvailable()).toBe(true);
  });

  it("recomputes every stored hash exactly", async () => {
    const events = chain();
    expect(events).toHaveLength(6);
    let prev = "GENESIS";
    for (const e of events) {
      const web = await ledgerHashWeb(prev, e);
      expect(web).toMatch(/^[0-9a-f]{64}$/);
      expect(web).toBe(e.hash);
      expect(web).toBe(ledgerHash(prev, e));
      prev = e.hash;
    }
    const res = await verifyChainWeb(events);
    expect(res).toMatchObject({ ok: true, brokenAtSeq: null });
    expect(res.links.every((l) => l.status === "ok")).toBe(true);
  });

  it("survives a JSON round trip", async () => {
    const events = JSON.parse(JSON.stringify(chain())) as WebLedgerEvent[];
    expect((await verifyChainWeb(events)).ok).toBe(true);
  });

  it("flips at the edited seq and fails every later event", async () => {
    const events = chain();
    const copy = structuredClone(events);
    (copy[2].data as { amount: { value: string } }).amount.value = "4.52";
    const res = await verifyChainWeb(copy);
    expect(res.ok).toBe(false);
    expect(res.brokenAtSeq).toBe(3);
    expect(res.links.map((l) => l.status)).toEqual(["ok", "ok", "hash-mismatch", "link-broken", "link-broken", "link-broken"]);
    expect(res.links[2].recomputed).not.toBe(events[2].hash);
    // the original is untouched
    expect((await verifyChainWeb(events)).ok).toBe(true);
  });

  it("flags a broken prevHash as link-broken at that event", async () => {
    const copy = structuredClone(chain());
    copy[3].prevHash = "0".repeat(64);
    const res = await verifyChainWeb(copy);
    expect(res.brokenAtSeq).toBe(4);
    expect(res.links[3].status).toBe("link-broken");
    expect(res.links[2].status).toBe("ok");
  });
});
