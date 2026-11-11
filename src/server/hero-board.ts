/**
 * The home page's clearance board: one real slip and the guard's verdicts on it, read from the ledger.
 * Prefers the Shop demo run (the hijacked cart story), then the newest slip the guard has checked.
 * Returns null when no slip has a verdict yet, so the page never shows invented strips.
 */
import type { Slip, Store } from "@/core/contracts";
import { boardStrips, type BoardStrip } from "@/components/board-strips";

export type { BoardStrip };

export interface HeroBoard {
  slip: Slip;
  strips: BoardStrip[];
  chain: { ok: boolean; brokenAtSeq: number | null };
  events: number;
  lastHash: string;
}

export function heroBoard(
  rt: { store: Store; orchestrator: { get(runId: string): { slipId: string | null } | null } },
  shopRunId: string | null,
): HeroBoard | null {
  const { store } = rt;
  const candidates: string[] = [];
  const run = shopRunId ? rt.orchestrator.get(shopRunId) : null;
  if (run?.slipId) candidates.push(run.slipId);
  for (const e of store.ledger.listRecent(200)) {
    if (e.type === "guard.verdict" && !candidates.includes(e.slipId)) candidates.push(e.slipId);
  }
  for (const id of candidates) {
    const slip = store.slips.get(id);
    if (!slip) continue;
    const events = store.ledger.list(id);
    const strips = boardStrips(events, 3);
    if (strips.length === 0) continue;
    return {
      slip,
      strips,
      chain: store.ledger.verifyChain(id),
      events: events.length,
      lastHash: events[events.length - 1]?.hash ?? "",
    };
  }
  return null;
}
