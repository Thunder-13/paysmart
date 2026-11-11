/**
 * Store over node:sqlite. One file (or ":memory:") holds slips, the hash-chained ledger,
 * blobs, and schemaless pipeline documents.
 */
import { EventEmitter } from "node:events";
import { DatabaseSync } from "node:sqlite";
import {
  SlipSchema,
  type Actor,
  type BlobStore,
  type Collection,
  type Ledger,
  type LedgerEvent,
  type LedgerEventType,
  type NewSlip,
  type PipelineId,
  type Slip,
  type SlipStore,
  type Store,
} from "../contracts";
import { newId } from "../ids";
import { zeroMoney } from "../money";
import { GENESIS, ledgerHash, normalizeJson } from "./canonical";

export interface SqliteStore extends Store {
  /** Raw handle, for tests (tamper checks) and maintenance scripts. */
  readonly db: DatabaseSync;
  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS slips (
  id TEXT PRIMARY KEY,
  pipeline TEXT NOT NULL,
  parent_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS slips_pipeline ON slips(pipeline);
CREATE INDEX IF NOT EXISTS slips_parent ON slips(parent_id);
CREATE TABLE IF NOT EXISTS slip_rail_ids (
  rail_id TEXT NOT NULL,
  slip_id TEXT NOT NULL,
  PRIMARY KEY (rail_id, slip_id)
);
CREATE INDEX IF NOT EXISTS slip_rail_ids_slip ON slip_rail_ids(slip_id);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slip_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  actor TEXT NOT NULL,
  at TEXT NOT NULL,
  data TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  UNIQUE (slip_id, seq)
);
CREATE TABLE IF NOT EXISTS blobs (
  ref TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  base64 TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS docs (
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  id TEXT NOT NULL,
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner, name, id)
);
`;

type Row = Record<string, unknown>;

function rowToEvent(r: Row): LedgerEvent {
  return {
    seq: Number(r.seq),
    slipId: String(r.slip_id),
    type: String(r.type),
    actor: String(r.actor) as Actor,
    at: String(r.at),
    data: JSON.parse(String(r.data)),
    prevHash: String(r.prev_hash),
    hash: String(r.hash),
  };
}

function railIds(slip: Slip): string[] {
  const r = slip.rail;
  return [r.orderId, r.authorizationId, ...r.captureIds, ...r.refundIds, ...r.payoutBatchIds].filter(
    (x): x is string => typeof x === "string" && x !== "",
  );
}

export function createSqliteStore(path: string | ":memory:", opts: { now?: () => Date } = {}): SqliteStore {
  const now = opts.now ?? (() => new Date());
  const db = new DatabaseSync(path);
  if (path !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA busy_timeout = 5000;");
  }
  db.exec(SCHEMA);

  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);

  function tx<T>(fn: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      db.exec("COMMIT");
      return out;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  /* ----------------------------------------------------------- slips */

  const stmt = {
    insertSlip: db.prepare(
      "INSERT INTO slips (id, pipeline, parent_id, status, created_at, json) VALUES (?, ?, ?, ?, ?, ?)",
    ),
    updateSlip: db.prepare("UPDATE slips SET status = ?, parent_id = ?, json = ? WHERE id = ?"),
    getSlip: db.prepare("SELECT json FROM slips WHERE id = ?"),
    delRail: db.prepare("DELETE FROM slip_rail_ids WHERE slip_id = ?"),
    insRail: db.prepare("INSERT OR IGNORE INTO slip_rail_ids (rail_id, slip_id) VALUES (?, ?)"),
    findRail: db.prepare(
      "SELECT s.json FROM slip_rail_ids r JOIN slips s ON s.id = r.slip_id WHERE r.rail_id = ? ORDER BY s.created_at LIMIT 1",
    ),
    lastEvent: db.prepare("SELECT seq, hash FROM ledger WHERE slip_id = ? ORDER BY seq DESC LIMIT 1"),
    insertEvent: db.prepare(
      "INSERT INTO ledger (slip_id, seq, type, actor, at, data, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ),
    listEvents: db.prepare("SELECT * FROM ledger WHERE slip_id = ? ORDER BY seq ASC"),
    recentEvents: db.prepare("SELECT * FROM ledger ORDER BY id DESC LIMIT ?"),
    putBlob: db.prepare("INSERT INTO blobs (ref, content_type, base64, created_at) VALUES (?, ?, ?, ?)"),
    getBlob: db.prepare("SELECT content_type, base64 FROM blobs WHERE ref = ?"),
    putDoc: db.prepare(
      "INSERT INTO docs (owner, name, id, json, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner, name, id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at",
    ),
    getDoc: db.prepare("SELECT json FROM docs WHERE owner = ? AND name = ? AND id = ?"),
    listDocs: db.prepare("SELECT json FROM docs WHERE owner = ? AND name = ? ORDER BY rowid ASC"),
    delDoc: db.prepare("DELETE FROM docs WHERE owner = ? AND name = ? AND id = ?"),
  };

  function writeRailIndex(slip: Slip): void {
    stmt.delRail.run(slip.id);
    for (const id of railIds(slip)) stmt.insRail.run(id, slip.id);
  }

  function readSlip(json: unknown): Slip {
    return JSON.parse(String(json)) as Slip;
  }

  const slips: SlipStore = {
    create(input: NewSlip): Slip {
      const slip: Slip = SlipSchema.parse({
        id: newId("slip"),
        pipeline: input.pipeline,
        parentId: input.parentId ?? null,
        principal: input.principal,
        intent: input.intent,
        clauses: input.clauses,
        budget: input.budget,
        spent: zeroMoney(input.budget.currency),
        status: "draft",
        rail: { orderId: null, authorizationId: null, approveUrl: null, captureIds: [], refundIds: [], payoutBatchIds: [] },
        createdAt: now().toISOString(),
        expiresAt: input.expiresAt,
        meta: input.meta ?? {},
      });
      tx(() => {
        stmt.insertSlip.run(slip.id, slip.pipeline, slip.parentId, slip.status, slip.createdAt, JSON.stringify(slip));
        writeRailIndex(slip);
      });
      return slip;
    },
    get(id: string): Slip | null {
      const row = stmt.getSlip.get(id) as Row | undefined;
      return row ? readSlip(row.json) : null;
    },
    update(id, patch): Slip {
      return tx(() => {
        const row = stmt.getSlip.get(id) as Row | undefined;
        if (!row) throw new Error(`Slip not found: ${id}`);
        const current = readSlip(row.json);
        const next: Slip = SlipSchema.parse({ ...current, ...patch, id: current.id, pipeline: current.pipeline, createdAt: current.createdAt });
        stmt.updateSlip.run(next.status, next.parentId, JSON.stringify(next), id);
        writeRailIndex(next);
        return next;
      });
    },
    list(filter = {}): Slip[] {
      const where: string[] = [];
      const params: string[] = [];
      if (filter.pipeline) {
        where.push("pipeline = ?");
        params.push(filter.pipeline);
      }
      if (filter.parentId) {
        where.push("parent_id = ?");
        params.push(filter.parentId);
      }
      if (filter.status) {
        where.push("status = ?");
        params.push(filter.status);
      }
      const sql = `SELECT json FROM slips ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, rowid DESC`;
      return (db.prepare(sql).all(...params) as Row[]).map((r) => readSlip(r.json));
    },
    findByRailId(railId: string): Slip | null {
      const row = stmt.findRail.get(railId) as Row | undefined;
      return row ? readSlip(row.json) : null;
    },
  };

  /* ---------------------------------------------------------- ledger */

  const ledger: Ledger = {
    append(slipId: string, type: LedgerEventType, actor: Actor, data: unknown): LedgerEvent {
      const event = tx(() => {
        const last = stmt.lastEvent.get(slipId) as Row | undefined;
        const seq = last ? Number(last.seq) + 1 : 1;
        const prevHash = last ? String(last.hash) : GENESIS;
        const body = { seq, slipId, type, actor, at: now().toISOString(), data: normalizeJson(data) };
        const hash = ledgerHash(prevHash, body);
        stmt.insertEvent.run(slipId, seq, type, actor, body.at, JSON.stringify(body.data), prevHash, hash);
        return { ...body, prevHash, hash } satisfies LedgerEvent;
      });
      emitter.emit("event", event);
      return event;
    },
    list(slipId: string): LedgerEvent[] {
      return (stmt.listEvents.all(slipId) as Row[]).map(rowToEvent);
    },
    listRecent(limit: number): LedgerEvent[] {
      return (stmt.recentEvents.all(Math.max(0, Math.floor(limit))) as Row[]).map(rowToEvent);
    },
    verifyChain(slipId: string) {
      const rows = stmt.listEvents.all(slipId) as Row[];
      let prev = GENESIS;
      let expectedSeq = 1;
      for (const r of rows) {
        const seq = Number(r.seq);
        if (seq !== expectedSeq || String(r.prev_hash) !== prev) return { ok: false, brokenAtSeq: seq };
        let data: unknown;
        try {
          data = JSON.parse(String(r.data));
        } catch {
          return { ok: false, brokenAtSeq: seq };
        }
        const hash = ledgerHash(prev, {
          seq,
          slipId: String(r.slip_id),
          type: String(r.type),
          actor: String(r.actor),
          at: String(r.at),
          data,
        });
        if (hash !== String(r.hash)) return { ok: false, brokenAtSeq: seq };
        prev = hash;
        expectedSeq += 1;
      }
      return { ok: true, brokenAtSeq: null };
    },
    subscribe(listener: (event: LedgerEvent) => void): () => void {
      emitter.on("event", listener);
      return () => {
        emitter.off("event", listener);
      };
    },
  };

  /* ----------------------------------------------------------- blobs */

  const blobs: BlobStore = {
    put(input) {
      const ref = newId("blob");
      stmt.putBlob.run(ref, input.contentType, input.base64, now().toISOString());
      return ref;
    },
    get(ref) {
      const row = stmt.getBlob.get(ref) as Row | undefined;
      return row ? { contentType: String(row.content_type), base64: String(row.base64) } : null;
    },
  };

  /* ------------------------------------------------------ collections */

  function collection<T>(owner: PipelineId | "core", name: string): Collection<T> {
    return {
      put(id: string, doc: T): T {
        stmt.putDoc.run(owner, name, id, JSON.stringify(doc), now().toISOString());
        return doc;
      },
      get(id: string): T | null {
        const row = stmt.getDoc.get(owner, name, id) as Row | undefined;
        return row ? (JSON.parse(String(row.json)) as T) : null;
      },
      list(): T[] {
        return (stmt.listDocs.all(owner, name) as Row[]).map((r) => JSON.parse(String(r.json)) as T);
      },
      remove(id: string): void {
        stmt.delDoc.run(owner, name, id);
      },
    };
  }

  return {
    db,
    slips,
    ledger,
    blobs,
    collection,
    close() {
      emitter.removeAllListeners();
      db.close();
    },
  };
}
