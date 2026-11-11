/**
 * Bounty run, second half: settle (capture every allocated pledge, then 1 payout), receipt, close.
 * Every money move goes through CoreServices, so the guard sees it and the ledger records it.
 */
import type { EvidenceRef, Money, NewProposal, Slip } from "@/core/contracts";
import { formatMoney, isZero } from "@/core/money";
import { allocate } from "../allocate";
import { bountyEvent, mustBounty, pledgeSlips, saveBounty, setSlipStatus, signedAtOf } from "../records";
import { CLOSABLE_BOUNTY_STATUSES, parseBountySignal, type Bounty, type CaptureLine } from "../schema";
import { errorText, waitForPayoutChoice, type Ctx, type Result, type Step } from "./shared";

const HELD = ["active", "settling", "settled"];

function bountyFor(ctx: Ctx): Bounty {
  const id = ctx.run.state.bountyId;
  if (!id) throw new Error("This run has no bounty yet.");
  return mustBounty(ctx.store, id);
}

const JOB_FACTS = {
  category: "community_job",
  inStock: true,
  deliveryEstimate: null,
  itemCount: 1,
  attributes: {},
  injectionSuspected: false,
};

export function pledgeProposal(bounty: Bounty, slip: Slip, amount: Money, evidence: EvidenceRef | null): NewProposal {
  return {
    slipId: slip.id,
    kind: "purchase",
    amount,
    payee: null,
    items: [{ title: `Bounty: ${bounty.title}`, quantity: 1, unitPrice: amount, facts: JOB_FACTS, sourceUrl: null }],
    evidence: evidence ? [evidence] : [],
    rationale: `Proof passed for "${bounty.title}"; capturing ${slip.principal.name}'s share of ${formatMoney(amount)}.`,
  };
}

export function payoutProposal(bounty: Bounty, receiver: { name: string; email: string }, amount: Money, evidence: EvidenceRef | null): NewProposal {
  return {
    slipId: bounty.payoutSlipId,
    kind: "payout",
    amount,
    payee: { email: receiver.email, name: receiver.name, merchantId: null },
    items: [],
    evidence: evidence ? [evidence] : [],
    rationale: `Pay ${receiver.name} the ${formatMoney(amount)} reward for "${bounty.title}".`,
  };
}

function verdictText(v: { decision: string; violations: { clauseId: string; message: string }[]; unknowns: { clauseId: string; message: string }[] }): string {
  const lines = [...v.violations, ...v.unknowns].map((x) => `${x.clauseId}: ${x.message}`);
  return `the guard said ${v.decision}${lines.length ? ` (${lines.join("; ")})` : ""}`;
}

/** Refund every capture made so far, void the rest, pay nothing. */
async function failSettlement(ctx: Ctx, bounty: Bounty, captures: CaptureLine[], reason: string): Promise<Result> {
  const refunded: string[] = [];
  const problems: string[] = [];
  for (const line of captures) {
    try {
      await ctx.core.refund(line.slipId, { captureId: line.captureId, reason: `Bounty settlement failed: ${reason}` });
      refunded.push(line.captureId);
    } catch (e) {
      problems.push(`refund ${line.captureId}: ${errorText(e)}`);
    }
  }
  const voided: string[] = [];
  for (const slip of pledgeSlips(ctx.store, bounty.id)) {
    if (slip.status !== "active") continue;
    try {
      await ctx.core.releaseRemainder(slip.id);
      voided.push(slip.id);
    } catch (e) {
      problems.push(`void ${slip.id}: ${errorText(e)}`);
    }
  }
  await ctx.core.releaseRemainder(bounty.payoutSlipId);
  saveBounty(ctx.store, bounty, { status: "settle_failed", captures, failure: reason }, ctx.now());
  bountyEvent(ctx.store, bounty.payoutSlipId, "bounty.settle_failed", "rail", {
    message: `Settlement stopped (${reason}). ${refunded.length} capture(s) refunded, ${voided.length} hold(s) voided, nothing paid out.`,
    reason,
    refunded,
    voided,
    problems,
  });
  return { done: true, state: { lastRejection: reason } };
}

/** Refund every capture after the organizer gives up on a failed payout. */
async function refundAll(ctx: Ctx, bounty: Bounty): Promise<Result> {
  const refunds: { captureId: string; refundId: string | null; error: string | null }[] = [];
  for (const line of bounty.captures) {
    try {
      const { refundId } = await ctx.core.refund(line.slipId, { captureId: line.captureId, reason: "The payout failed and the organizer refunded the backers." });
      refunds.push({ captureId: line.captureId, refundId, error: null });
    } catch (e) {
      refunds.push({ captureId: line.captureId, refundId: null, error: errorText(e) });
    }
  }
  await ctx.core.releaseRemainder(bounty.payoutSlipId);
  saveBounty(ctx.store, bounty, { status: "refunded" }, ctx.now());
  bountyEvent(ctx.store, bounty.payoutSlipId, "bounty.refunded", "user", {
    message: `The organizer refunded ${refunds.filter((r) => r.refundId).length} of ${refunds.length} backer capture(s) after the payout failed.`,
    refunds,
  });
  return { done: true, state: { lastRejection: null } };
}

async function payOut(ctx: Ctx, bounty: Bounty): Promise<Result> {
  const worker = bounty.claim;
  if (!worker) return { fail: "Nobody claimed this bounty, so there is nobody to pay." };
  const slip = ctx.store.slips.get(bounty.payoutSlipId);
  if (!slip) return { fail: `Payout slip ${bounty.payoutSlipId} is missing.` };

  // Never a second batch: a payout slip that already has one is paid.
  let batchId = slip.rail.payoutBatchIds[0] ?? null;
  if (!batchId) {
    const backers = bounty.captures.length;
    try {
      const res = await ctx.core.settlePayout(
        slip.id,
        payoutProposal(bounty, { name: worker.workerName, email: worker.workerEmail }, bounty.reward, bounty.evidence),
        [
          {
            receiverEmail: worker.workerEmail,
            amount: bounty.reward,
            note: `Bounty paid: ${bounty.title}. Thanks from ${backers} neighbor${backers === 1 ? "" : "s"}.`,
          },
        ],
      );
      if (res.verdict.decision !== "within" || !res.payoutBatchId) throw new Error(verdictText(res.verdict));
      batchId = res.payoutBatchId;
    } catch (e) {
      const reason = errorText(e);
      const saved = saveBounty(ctx.store, bounty, { status: "payout_failed", failure: reason }, ctx.now());
      bountyEvent(ctx.store, bounty.payoutSlipId, "bounty.payout_failed", "rail", { message: `The payout did not go through: ${reason}`, reason });
      return waitForPayoutChoice(saved, reason);
    }
  }
  saveBounty(
    ctx.store,
    bounty,
    { status: "paid", failure: null, payout: { batchId, status: "CREATED", amount: bounty.reward, receiverEmail: worker.workerEmail } },
    ctx.now(),
  );
  bountyEvent(ctx.store, bounty.payoutSlipId, "bounty.paid", "rail", {
    message: `${worker.workerName} was paid ${formatMoney(bounty.reward)} through PayPal Payouts (batch ${batchId}).`,
    payoutBatchId: batchId,
    amount: bounty.reward,
    worker: { name: worker.workerName, email: worker.workerEmail },
    captures: bounty.captures,
  });
  return { next: "receipt", state: { lastRejection: null } };
}

export const settle: Step = async (ctx) => {
  let bounty = bountyFor(ctx);
  if (bounty.status === "payout_failed") {
    const parsed = parseBountySignal(ctx.signal);
    if (parsed.ok && parsed.signal.event === "payout_refund") return refundAll(ctx, bounty);
    if (!parsed.ok) return waitForPayoutChoice(bounty, parsed.reason);
    if (parsed.signal.event !== "payout_retry") return waitForPayoutChoice(bounty, undefined);
    return payOut(ctx, bounty);
  }
  if (bounty.status !== "verified") return { fail: `Bounty ${bounty.id} is ${bounty.status}; only a verified bounty can settle.` };
  if (!bounty.evidence) return { fail: "Verified bounty has no evidence to settle with." };

  const pledges = pledgeSlips(ctx.store, bounty.id).filter((s) => HELD.includes(s.status));
  const plan = allocate(
    bounty.reward,
    pledges.map((s) => ({ slipId: s.id, budget: s.budget, signedAt: signedAtOf(s) })),
  );
  const captures = [...bounty.captures];
  for (const line of plan) {
    const slip = ctx.store.slips.get(line.slipId);
    if (!slip) continue;
    if (isZero(line.amount)) {
      await ctx.core.releaseRemainder(slip.id);
      continue;
    }
    if (captures.some((c) => c.slipId === slip.id)) continue;
    try {
      const res = await ctx.core.settlePurchase(slip.id, pledgeProposal(bounty, slip, line.amount, bounty.evidence), { finalCapture: true });
      if (res.verdict.decision !== "within" || !res.captureId) throw new Error(verdictText(res.verdict));
      captures.push({ slipId: slip.id, backer: slip.principal.name, amount: line.amount, captureId: res.captureId });
      bounty = saveBounty(ctx.store, bounty, { captures }, ctx.now());
    } catch (e) {
      return failSettlement(ctx, bounty, captures, `Capturing ${slip.principal.name}'s pledge failed: ${errorText(e)}`);
    }
  }
  return payOut(ctx, bounty);
};

export const receipt: Step = async (ctx) => {
  const bounty = bountyFor(ctx);
  if (bounty.payout) {
    try {
      const p = await ctx.rail.getPayout(bounty.payout.batchId);
      saveBounty(ctx.store, bounty, { payout: { ...bounty.payout, status: p.status } }, ctx.now());
    } catch (e) {
      ctx.log("Could not read the payout batch status yet.", { error: errorText(e) });
    }
  }
  return { done: true };
};

export const close: Step = async (ctx) => {
  const bounty = bountyFor(ctx);
  if (!CLOSABLE_BOUNTY_STATUSES.includes(bounty.status)) return { done: true };
  const reason = ctx.run.state.closeReason ?? "expired";
  const released: string[] = [];
  const expired: string[] = [];
  for (const slip of pledgeSlips(ctx.store, bounty.id)) {
    if (slip.status === "active") {
      await ctx.core.releaseRemainder(slip.id);
      released.push(slip.id);
    } else if (slip.status === "draft" || slip.status === "awaiting_signature") {
      setSlipStatus(
        ctx.store,
        slip,
        "expired",
        reason === "expired" ? "The bounty passed its deadline before this pledge was signed." : "The bounty was cancelled before this pledge was signed.",
      );
      expired.push(slip.id);
    }
  }
  const payout = ctx.store.slips.get(bounty.payoutSlipId);
  if (payout) {
    if (reason === "cancelled") await ctx.core.releaseRemainder(payout.id);
    else setSlipStatus(ctx.store, payout, "expired", "The deadline passed before any proof was verified.");
  }
  saveBounty(ctx.store, bounty, { status: reason }, ctx.now());
  bountyEvent(ctx.store, bounty.payoutSlipId, `bounty.${reason}`, reason === "cancelled" ? "user" : "system", {
    message:
      reason === "cancelled"
        ? `The organizer cancelled; ${released.length} hold(s) voided.`
        : `The deadline passed without verified proof; ${released.length} hold(s) voided.`,
    released,
    expired,
  });
  return { done: true };
};
