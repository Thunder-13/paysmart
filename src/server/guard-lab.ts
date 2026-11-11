/**
 * The Guard Lab's data: one real guard.verdict from the ledger, with the facts the guard saw.
 * The client re-runs the same pure guard on edited copies. Prefers the featured Shop run's slip,
 * then the newest slip with an outside verdict. Returns null when no slip qualifies.
 */
import { INTEGRITY_CLAUSE_ID, type Money, type Proposal, type Slip, type Store, type Verdict } from "@/core/contracts";
import type { GuardVerdictData, RailCapturedData } from "@/core/events";
import { fromCents, toCents } from "@/core/money";

export interface GuardLab {
  /** The slip, with the principal's email removed. */
  slip: Slip;
  proposal: Proposal;
  stored: Verdict;
  seq: number;
  hash: string;
  spent: Money;
  now: string;
}

type Rt = { store: Store; orchestrator: { get(runId: string): { slipId: string | null } | null } };

export function guardLab(rt: Rt, shopRunId: string | null): GuardLab | null {
  const { store } = rt;
  const candidates: string[] = [];
  const run = shopRunId ? rt.orchestrator.get(shopRunId) : null;
  if (run?.slipId) candidates.push(run.slipId);
  for (const e of store.ledger.listRecent(400)) {
    if (e.type === "guard.verdict" && !candidates.includes(e.slipId)) candidates.push(e.slipId);
  }
  for (const id of candidates) {
    const slip = store.slips.get(id);
    if (!slip) continue;
    const events = store.ledger.list(id);
    const outside = events.filter((e) => e.type === "guard.verdict" && (e.data as GuardVerdictData).verdict.decision === "outside");
    const pick = outside.find((e) => (e.data as GuardVerdictData).verdict.violations.some((v) => v.clauseId === INTEGRITY_CLAUSE_ID)) ?? outside[0];
    if (!pick) continue;
    const { proposal, verdict } = pick.data as GuardVerdictData;
    const currency = slip.budget.currency;
    let cents = 0;
    for (const e of events) {
      if (e.type !== "rail.captured" || e.seq >= pick.seq) continue;
      const amount = (e.data as RailCapturedData).amount;
      if (amount.currency.toUpperCase() === currency.toUpperCase()) cents += toCents(amount);
    }
    return {
      slip: { ...slip, principal: { name: slip.principal.name, email: null } },
      proposal,
      stored: verdict,
      seq: pick.seq,
      hash: pick.hash,
      spent: fromCents(cents, currency),
      now: verdict.checkedAt,
    };
  }
  return null;
}
