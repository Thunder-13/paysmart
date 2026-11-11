/**
 * "Item never arrived" hand-off (D9): one record per capture in store.collection("second-look",
 * "handoffs"), keyed by capture id. Dispute Desk reads these and builds the evidence pack.
 */
import type { Run, Store } from "@/core/contracts";
import type { HandoffRecord, SecondLookState } from "./types";

export class HandoffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandoffError";
  }
}

export function handoffsCollection(store: Store) {
  return store.collection<HandoffRecord>("second-look", "handoffs");
}

export function getHandoff(store: Store, runId: string): HandoffRecord | null {
  return handoffsCollection(store).list().find((h) => h.runId === runId) ?? null;
}

/** Writes (or returns the existing) hand-off for a run's capture. Throws HandoffError without a capture. */
export function recordHandoff(store: Store, run: Run<SecondLookState>, now: Date): HandoffRecord {
  if (run.pipeline !== "second-look") throw new HandoffError(`Run ${run.id} is not a Second Look run.`);
  const state = run.state;
  const captureId = state.captureId;
  if (!captureId || !run.slipId) {
    throw new HandoffError("Only a payment that went through can be reported as never arrived. This run has no capture.");
  }
  const col = handoffsCollection(store);
  const existing = col.get(captureId);
  if (existing) return existing;
  const slip = store.slips.get(run.slipId);
  const record: HandoffRecord = {
    id: captureId,
    captureId,
    orderId: state.orderId ?? slip?.rail.orderId ?? null,
    slipId: run.slipId,
    runId: run.id,
    sellerEmail: state.input.sellerEmail,
    amount: state.input.amount,
    reason: "item_not_received",
    trackingNumber: state.tracking?.number ?? null,
    carrier: state.tracking?.carrier ?? null,
    riskScore: state.analysis?.riskScore ?? null,
    tactics: state.analysis?.tactics.map((t) => t.id) ?? [],
    createdAt: now.toISOString(),
    status: "open",
  };
  col.put(record.id, record);
  store.ledger.append(run.slipId, "second-look.handoff_created", "user", {
    message: "Buyer reported the item never arrived; handed to Dispute Desk",
    captureId,
    handoffId: record.id,
    reason: record.reason,
  });
  return record;
}
