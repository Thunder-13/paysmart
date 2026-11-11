/**
 * The Chain Lab's data: the real ledger events of the slip the home clearance board shows, with
 * their stored hashes, so the browser can re-verify the chain with Web Crypto.
 */
import type { LedgerEvent, Store } from "@/core/contracts";

export const CHAIN_LAB_MAX_EVENTS = 80;

export interface ChainLabData {
  slipId: string;
  events: LedgerEvent[];
}

export function chainLab(
  rt: { store: Store; orchestrator: { get(runId: string): { slipId: string | null } | null } },
  shopRunId: string | null,
): ChainLabData | null {
  const { store } = rt;
  const candidates: string[] = [];
  const run = shopRunId ? rt.orchestrator.get(shopRunId) : null;
  if (run?.slipId) candidates.push(run.slipId);
  for (const e of store.ledger.listRecent(200)) {
    if (e.type === "guard.verdict" && !candidates.includes(e.slipId)) candidates.push(e.slipId);
  }
  for (const id of candidates) {
    if (!store.slips.get(id)) continue;
    const events = store.ledger.list(id);
    if (!events.some((e) => e.type === "guard.verdict")) continue;
    return {
      slipId: id,
      events: events.slice(0, CHAIN_LAB_MAX_EVENTS).map((e) => ({
        seq: e.seq,
        slipId: e.slipId,
        type: e.type,
        actor: e.actor,
        at: e.at,
        data: e.data,
        prevHash: e.prevHash,
        hash: e.hash,
      })),
    };
  }
  return null;
}
