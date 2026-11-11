/**
 * Read model for the board page and GET /api/p/bounty: every bounty with its slips, funding and
 * run state. Funding is derived from pledge slips, so the bar is right even while the run sleeps.
 */
import type { Money, Run, RunStatus, RunWait, Slip, Store } from "@/core/contracts";
import { bounties, fundedTotal, pledgeSlips } from "./records";
import type { Bounty, BountyState } from "./schema";

export interface BoardRun {
  id: string;
  status: RunStatus;
  step: string;
  wait: RunWait | null;
  error: string | null;
  lastRejection: string | null;
}

export interface BoardEntry {
  bounty: Bounty;
  payoutSlip: Slip | null;
  pledges: Slip[];
  funded: Money;
  run: BoardRun | null;
}

export interface BoardData {
  bounties: BoardEntry[];
  generatedAt: string;
}

export function buildBoard(rt: { store: Store; orchestrator: { get(runId: string): Run | null }; now(): Date }): BoardData {
  const entries = bounties(rt.store)
    .list()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((bounty): BoardEntry => {
      const run = rt.orchestrator.get(bounty.runId) as Run<BountyState> | null;
      return {
        bounty,
        payoutSlip: rt.store.slips.get(bounty.payoutSlipId),
        pledges: pledgeSlips(rt.store, bounty.id),
        funded: fundedTotal(rt.store, bounty),
        run: run
          ? { id: run.id, status: run.status, step: run.step, wait: run.wait, error: run.error, lastRejection: run.state.lastRejection ?? null }
          : null,
      };
    });
  return { bounties: entries, generatedAt: rt.now().toISOString() };
}
