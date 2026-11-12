import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LedgerEvent } from "../contracts";
import { newSlipInput } from "../test-helpers";
import { tamperEvent } from "./tamper";
import { canonicalJson, GENESIS, ledgerHash } from "./canonical";
import { createLibsqlStore, createSqliteStore, type SqliteStore } from "./sqlite";

const REMOTE = process.env.LIBSQL_TEST_URL;
const TABLES = ["slips", "slip_rail_ids", "ledger", "blobs", "docs"];

type Backend = "node:sqlite" | "libsql";
let backend: Backend = "node:sqlite";
const opened: SqliteStore[] = [];

/** Build a store on the backend under test. The remote DB is shared, so tables are dropped first. */
function store(): SqliteStore {
  let t = Date.parse("2026-11-08T12:00:00.000Z");
  const now = () => new Date((t += 1000));
  let s: SqliteStore;
  if (backend === "libsql") {
    const wipe = createLibsqlStore({ url: REMOTE ?? "", authToken: process.env.LIBSQL_TEST_TOKEN });
    for (const tbl of TABLES) wipe.db.exec(`DROP TABLE IF EXISTS ${tbl}`);
    wipe.close();
    s = createLibsqlStore({ url: REMOTE ?? "", authToken: process.env.LIBSQL_TEST_TOKEN, now });
  } else {
    s = createSqliteStore(":memory:", { now });
  }
  opened.push(s);
  return s;
}

afterEach(() => {
  for (const s of opened.splice(0)) s.close();
});

describe("canonicalJson", () => {
  it("sorts keys at every depth and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[3,{"y":2,"z":1}]},"b":1}');
  });
});


describe.each<Backend>(["node:sqlite", "libsql"])("store on %s", (name) => {
  const skip = name === "libsql" && !REMOTE;
  beforeEach(() => {
    backend = name;
  });
  describe.skipIf(skip)("cases", () => {
    describe("slips", () => {
      it("creates drafts with zero spend and empty rail ids", () => {
        const s = store();
        const slip = s.slips.create(newSlipInput());
        expect(slip.id).toMatch(/^slip_[0-9a-z]{16}$/);
        expect(slip.status).toBe("draft");
        expect(slip.spent).toEqual({ currency: "USD", value: "0.00" });
        expect(s.slips.get(slip.id)).toEqual(slip);
      });

      it("updates, filters and finds by any rail id", () => {
        const s = store();
        const parent = s.slips.create(newSlipInput());
        const child = s.slips.create(newSlipInput({ parentId: parent.id, pipeline: "bounty" }));
        s.slips.update(parent.id, {
          status: "active",
          rail: { ...parent.rail, orderId: "ORDER1", authorizationId: "AUTH1", captureIds: ["CAP1"], refundIds: ["REF1"], payoutBatchIds: ["BATCH1"] },
        });
        for (const id of ["ORDER1", "AUTH1", "CAP1", "REF1", "BATCH1"]) {
          expect(s.slips.findByRailId(id)?.id).toBe(parent.id);
        }
        expect(s.slips.findByRailId("nope")).toBeNull();
        expect(s.slips.list({ parentId: parent.id }).map((x) => x.id)).toEqual([child.id]);
        expect(s.slips.list({ pipeline: "bounty" })).toHaveLength(1);
        expect(s.slips.list({ status: "active" }).map((x) => x.id)).toEqual([parent.id]);
        expect(() => s.slips.update("slip_missing", { status: "active" })).toThrow(/not found/);
      });
    });

    describe("ledger", () => {
      it("hash-chains events per slip starting from GENESIS", () => {
        const s = store();
        const a = s.ledger.append("slip_a", "note", "system", { message: "one" });
        const b = s.ledger.append("slip_a", "note", "agent", { message: "two", extra: undefined });
        const other = s.ledger.append("slip_b", "note", "system", { message: "x" });
        expect(a.seq).toBe(1);
        expect(a.prevHash).toBe(GENESIS);
        expect(b.seq).toBe(2);
        expect(b.prevHash).toBe(a.hash);
        expect(other.seq).toBe(1);
        expect(b.hash).toBe(ledgerHash(a.hash, { seq: 2, slipId: "slip_a", type: "note", actor: "agent", at: b.at, data: { message: "two" } }));
        expect(s.ledger.list("slip_a").map((e) => e.seq)).toEqual([1, 2]);
        expect(s.ledger.listRecent(2).map((e) => e.slipId)).toEqual(["slip_b", "slip_a"]);
        expect(s.ledger.verifyChain("slip_a")).toEqual({ ok: true, brokenAtSeq: null });
      });

      it("detects a tampered row at that seq", () => {
        const s = store();
        for (let i = 0; i < 4; i++) s.ledger.append("slip_t", "note", "system", { message: `e${i}` });
        tamperEvent(s, "slip_t", 3);
        expect(s.ledger.verifyChain("slip_t")).toEqual({ ok: false, brokenAtSeq: 3 });
      });

      it("detects a rewritten hash and a deleted row", () => {
        const s = store();
        for (let i = 0; i < 3; i++) s.ledger.append("slip_t", "note", "system", { message: `e${i}` });
        s.db.prepare("UPDATE ledger SET type = 'rail.captured' WHERE slip_id = 'slip_t' AND seq = 2").run();
        expect(s.ledger.verifyChain("slip_t").brokenAtSeq).toBe(2);

        const s2 = store();
        for (let i = 0; i < 3; i++) s2.ledger.append("slip_u", "note", "system", { message: `e${i}` });
        s2.db.prepare("DELETE FROM ledger WHERE slip_id = 'slip_u' AND seq = 2").run();
        expect(s2.ledger.verifyChain("slip_u")).toEqual({ ok: false, brokenAtSeq: 3 });
      });

      it("notifies subscribers live and stops after unsubscribe", () => {
        const s = store();
        const seen: LedgerEvent[] = [];
        const off = s.ledger.subscribe((e) => seen.push(e));
        s.ledger.append("slip_a", "note", "system", { message: "hi" });
        off();
        s.ledger.append("slip_a", "note", "system", { message: "bye" });
        expect(seen.map((e) => (e.data as { message: string }).message)).toEqual(["hi"]);
      });
    });

    describe("blobs and collections", () => {
      it("stores blobs by ref", () => {
        const s = store();
        const ref = s.blobs.put({ contentType: "image/png", base64: "iVBORw0KGgo=" });
        expect(ref).toMatch(/^blob_/);
        expect(s.blobs.get(ref)).toEqual({ contentType: "image/png", base64: "iVBORw0KGgo=" });
        expect(s.blobs.get("blob_missing")).toBeNull();
      });

      it("keeps per-owner collections apart and preserves insertion order on update", () => {
        const s = store();
        const runs = s.collection<{ n: number }>("core", "runs");
        const other = s.collection<{ n: number }>("shop", "runs");
        runs.put("a", { n: 1 });
        runs.put("b", { n: 2 });
        runs.put("a", { n: 3 });
        other.put("a", { n: 9 });
        expect(runs.list()).toEqual([{ n: 3 }, { n: 2 }]);
        expect(other.get("a")).toEqual({ n: 9 });
        runs.remove("a");
        expect(runs.get("a")).toBeNull();
      });
    });
  });
});

// The server drops an idle stream after a few seconds; a long-lived instance must still work after that.
describe.skipIf(!REMOTE)("libsql after an idle gap", () => {
  it("reconnects when the server stream has expired", async () => {
    const s = createLibsqlStore({ url: REMOTE ?? "", authToken: process.env.LIBSQL_TEST_TOKEN });
    const docs = s.collection<{ n: number }>("core", "idle-test");
    docs.put("x", { n: 1 });
    await new Promise((r) => setTimeout(r, 12_000));
    expect(docs.get("x")).toEqual({ n: 1 });
    docs.put("x", { n: 2 });
    expect(docs.get("x")).toEqual({ n: 2 });
    docs.remove("x");
    s.close();
  }, 30_000);
});
