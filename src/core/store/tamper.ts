import type { Store } from "../contracts";
import type { SqliteStore } from "./sqlite";

/**
 * Corrupt one stored ledger event (its data) without fixing the hashes, so
 * store.ledger.verifyChain(slipId) reports brokenAtSeq === seq. Test and demo use only.
 */
export function tamperEvent(store: Store, slipId: string, seq: number): void {
  const db = (store as Partial<SqliteStore>).db;
  if (!db) throw new Error("tamperEvent needs the SQLite store (createTestRuntime() or createSqliteStore())");
  const row = db.prepare("SELECT data FROM ledger WHERE slip_id = ? AND seq = ?").get(slipId, seq) as { data: string } | undefined;
  if (!row) throw new Error(`No ledger event ${slipId}#${seq}`);
  const data = JSON.parse(row.data) as unknown;
  const tampered =
    data && typeof data === "object" && !Array.isArray(data)
      ? { ...(data as Record<string, unknown>), tampered: true }
      : { original: data, tampered: true };
  db.prepare("UPDATE ledger SET data = ? WHERE slip_id = ? AND seq = ?").run(JSON.stringify(tampered), slipId, seq);
}
