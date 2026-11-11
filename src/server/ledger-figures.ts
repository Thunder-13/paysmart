/**
 * Money and chain figures read straight from the hash-chained ledger, so every number on the home
 * console, the demo seed table and the red-team report comes from the same recorded events.
 *
 *   held      sum of rail.authorized amounts (what PayPal put on hold at signing)
 *   captured  sum of rail.captured amounts (AUTHORIZE captures and CAPTURE-intent payments)
 *   released  for each slip whose hold closed (voided, or a final capture): held minus captured
 *   paidOut   sum of rail.payout_created item amounts (PayPal Payouts)
 *   refunded  sum of rail.refunded amounts
 */
import type { Money, PipelineId, Store } from "@/core/contracts";
import { PIPELINE_IDS } from "@/core/contracts";
import { fromCents } from "@/core/money";

export interface MoneyFigures {
  held: Money;
  captured: Money;
  released: Money;
  paidOut: Money;
  refunded: Money;
}

export interface ChainFigures {
  ok: boolean;
  slips: number;
  events: number;
  broken: { slipId: string; brokenAtSeq: number | null }[];
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

/** Cents of a Money-shaped value in the wanted currency, else 0. */
function centsOf(v: unknown, currency: string): number {
  const m = obj(v);
  if (typeof m.value !== "string" || typeof m.currency !== "string") return 0;
  if (m.currency.toUpperCase() !== currency.toUpperCase()) return 0;
  const n = Math.round(Number(m.value) * 100);
  return Number.isFinite(n) ? n : 0;
}

export function moneyFigures(store: Store, slipIds: string[], currency = "USD"): MoneyFigures {
  let held = 0;
  let captured = 0;
  let released = 0;
  let paidOut = 0;
  let refunded = 0;
  for (const slipId of new Set(slipIds)) {
    let slipHeld = 0;
    let slipCaptured = 0;
    let closed = false;
    for (const e of store.ledger.list(slipId)) {
      const d = obj(e.data);
      switch (e.type) {
        case "rail.authorized":
          slipHeld += centsOf(d.amount, currency);
          break;
        case "rail.captured":
          slipCaptured += centsOf(d.amount, currency);
          // A final capture makes PayPal release the rest of the hold, so no void event follows.
          if (d.finalCapture === true) closed = true;
          break;
        case "rail.voided":
          closed = true;
          break;
        case "rail.payout_created":
          for (const item of Array.isArray(d.items) ? d.items : []) paidOut += centsOf(obj(item).amount, currency);
          break;
        case "rail.refunded":
          refunded += centsOf(d.amount, currency);
          break;
      }
    }
    held += slipHeld;
    captured += slipCaptured;
    if (closed) released += Math.max(0, slipHeld - slipCaptured);
  }
  return {
    held: fromCents(held, currency),
    captured: fromCents(captured, currency),
    released: fromCents(released, currency),
    paidOut: fromCents(paidOut, currency),
    refunded: fromCents(refunded, currency),
  };
}

export function chainFigures(store: Store, slipIds: string[]): ChainFigures {
  const ids = [...new Set(slipIds)];
  const broken: ChainFigures["broken"] = [];
  let events = 0;
  for (const slipId of ids) {
    events += store.ledger.list(slipId).length;
    const chain = store.ledger.verifyChain(slipId);
    if (!chain.ok) broken.push({ slipId, brokenAtSeq: chain.brokenAtSeq });
  }
  return { ok: broken.length === 0, slips: ids.length, events, broken };
}

export interface PipelineFigures {
  pipeline: PipelineId;
  slips: number;
  runs: number;
  /** Captured plus paid out: every PayPal money movement (a bounty's $40 counts twice: in, then out). */
  moved: Money;
  captured: Money;
  paidOut: Money;
  refunded: Money;
  chain: ChainFigures;
}

/** Per-pipeline slip count, run count, money moved and chain status, plus the ledger-wide chain. */
export function consoleFigures(rt: { store: Store; orchestrator: { list(filter?: { pipeline?: PipelineId }): unknown[] } }): {
  pipelines: Record<PipelineId, PipelineFigures>;
  ledger: ChainFigures;
} {
  const all = rt.store.slips.list();
  const pipelines = {} as Record<PipelineId, PipelineFigures>;
  for (const id of PIPELINE_IDS) {
    const ids = all.filter((s) => s.pipeline === id).map((s) => s.id);
    const m = moneyFigures(rt.store, ids);
    pipelines[id] = {
      pipeline: id,
      slips: ids.length,
      runs: rt.orchestrator.list({ pipeline: id }).length,
      moved: fromCents(centsOf(m.captured, "USD") + centsOf(m.paidOut, "USD"), "USD"),
      captured: m.captured,
      paidOut: m.paidOut,
      refunded: m.refunded,
      chain: chainFigures(rt.store, ids),
    };
  }
  return { pipelines, ledger: chainFigures(rt.store, all.map((s) => s.id)) };
}
