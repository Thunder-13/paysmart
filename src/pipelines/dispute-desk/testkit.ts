/**
 * Shared builders for Dispute Desk tests and the smoke script. Slip histories are created through
 * core APIs (sign, guard, capture, evidence, refund) so the ledger shapes are the real ones.
 */
import type { Clause, Run } from "@/core/contracts";
import { money } from "@/core/money";
import { facts, item, newProposal } from "@/core/test-helpers";
import { createTestRuntime } from "@/core/testing";
import definition from "./index";
import type { DisputeDeskState } from "./types";

export const TEST_NOW = new Date("2026-11-10T12:00:00.000Z");

export function deskRuntime(opts: { seedRail?: boolean; now?: () => Date } = {}) {
  return createTestRuntime({
    now: opts.now ?? (() => TEST_NOW),
    pipelines: { "dispute-desk": definition },
    seedRail: opts.seedRail ?? false,
  });
}
export type DeskTestRuntime = ReturnType<typeof deskRuntime>;

export const CLAUSES: Clause[] = [
  { id: "c1", kind: "budget_max", label: "Spend at most $60", amount: money("60.00") },
  { id: "c2", kind: "exclude_attribute", label: "Nothing that needs batteries", attribute: "power_source", values: ["battery"] },
  { id: "c3", kind: "deliver_by", label: "Arrives by Nov 25", date: "2026-11-25" },
];

export const TRACKING_NUMBER = "1Z999AA10123456784";

/** Slip written, signed (authorized), optionally one blocked proposal, then a $48 final capture. */
export async function signedPurchase(rt: DeskTestRuntime, opts: { blockedFirst?: boolean } = {}): Promise<{ slipId: string; captureId: string }> {
  const slip = rt.core.createSlip({
    pipeline: "shop",
    principal: { name: "Ada", email: "ada@example.com" },
    intent: "Birthday gift for Leo, under $60, nothing with batteries",
    clauses: CLAUSES,
    budget: money("60.00"),
    expiresAt: "2026-11-13T00:00:00.000Z",
  });
  const { orderId } = await rt.core.beginSigning(slip.id, { intent: "AUTHORIZE", returnPath: "/p/shop" });
  rt.mockRail.approveOrder(orderId, "ada@example.com");
  await rt.core.completeSigning(slip.id);
  if (opts.blockedFirst) {
    const battery = item({ title: "RC dinosaur", unitPrice: money("40.00"), facts: facts({ attributes: { power_source: "battery" } }) });
    rt.core.evaluate(slip.id, newProposal({ slipId: slip.id, amount: money("40.00"), items: [battery] }));
  }
  const puzzle = item({ title: "Wooden dinosaur puzzle", unitPrice: money("48.00") });
  const res = await rt.core.settlePurchase(slip.id, newProposal({ slipId: slip.id, amount: money("48.00"), items: [puzzle] }), { finalCapture: true });
  if (!res.captureId) throw new Error(`test purchase was blocked: ${JSON.stringify(res.verdict)}`);
  return { slipId: slip.id, captureId: res.captureId };
}

/** Scenario (a): capture plus passing tracking evidence. */
export async function notReceivedHistory(rt: DeskTestRuntime, opts: { blockedFirst?: boolean } = {}) {
  const p = await signedPurchase(rt, opts);
  rt.core.addEvidence(p.slipId, { kind: "tracking", verdict: "pass", detail: "Delivered to the front door on 2026-11-07", ref: TRACKING_NUMBER });
  return p;
}

/** Scenario (b): the delivery check failed clause c2, then a full refund. */
export async function notAsDescribedHistory(rt: DeskTestRuntime) {
  const p = await signedPurchase(rt);
  rt.core.addEvidence(p.slipId, { kind: "delivery_photo", verdict: "fail", detail: "Photo shows a battery compartment, which breaks c2", ref: null });
  await rt.core.refund(p.slipId, { captureId: p.captureId, reason: "Delivery check failed c2" });
  return p;
}

export async function startDesk(rt: DeskTestRuntime, disputeId: string): Promise<Run<DisputeDeskState>> {
  return (await rt.orchestrator.start("dispute-desk", { disputeId })) as Run<DisputeDeskState>;
}

export async function resumeDesk(rt: DeskTestRuntime, runId: string, signal: unknown): Promise<Run<DisputeDeskState>> {
  return (await rt.orchestrator.resume(runId, signal)) as Run<DisputeDeskState>;
}
