/**
 * Clearance-board strips derived from a slip's ledger: one strip per guard.verdict event.
 * Pure and safe on server and client; the home hero and the Shop run view both read it.
 */
import type { LedgerEvent, Money, Verdict } from "@/core/contracts";
import type { GuardVerdictData } from "@/core/events";

export interface BoardStrip {
  seq: number;
  hash: string;
  at: string;
  decision: Verdict["decision"];
  amount: Money;
  /** First item's title, with how many more items the proposal carried. */
  title: string;
  more: number;
  /** Clause ids the verdict broke, in the guard's order (integrity first when present). */
  broken: string[];
  /** Clause ids the guard could not confirm. */
  unknown: string[];
  /** Where the facts came from: the listing's host, and whether its text tried to instruct the agent. */
  origin: { host: string | null; injection: boolean };
}

function host(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

function toStrip(e: LedgerEvent): BoardStrip | null {
  const d = e.data as Partial<GuardVerdictData> | null;
  if (!d || !d.verdict || !d.proposal) return null;
  const items = d.proposal.items ?? [];
  const first = items[0];
  const kindWord = d.proposal.kind === "child_slip" ? "Helper slip" : d.proposal.kind === "payout" ? "Payout" : String(d.proposal.kind ?? "proposal");
  return {
    seq: e.seq,
    hash: e.hash,
    at: e.at,
    decision: d.verdict.decision,
    amount: d.proposal.amount,
    title: first?.title ?? kindWord,
    more: Math.max(0, items.length - 1),
    broken: d.verdict.violations.map((v) => v.clauseId),
    unknown: d.verdict.unknowns.map((u) => u.clauseId),
    origin: {
      host: host(items.find((i) => i.facts?.injectionSuspected)?.sourceUrl ?? first?.sourceUrl),
      injection: items.some((i) => i.facts?.injectionSuspected === true),
    },
  };
}

/** Up to `limit` strips, oldest first; a repeat check of the same cart with the same outcome folds into the first. */
export function boardStrips(events: LedgerEvent[], limit: number): BoardStrip[] {
  const out: BoardStrip[] = [];
  for (const e of events) {
    if (e.type !== "guard.verdict") continue;
    const s = toStrip(e);
    if (!s) continue;
    if (out.some((p) => p.decision === s.decision && p.title === s.title && p.amount.value === s.amount.value)) continue;
    out.push(s);
  }
  return out.slice(0, limit);
}
