import type { Clause, Money, StepContext, StepResult } from "@/core/contracts";
import { formatMoney } from "@/core/money";
import { CLOSABLE_BOUNTY_STATUSES, type Bounty, type BountyState, type ParsedSignal } from "../schema";

export type Ctx = StepContext<BountyState>;
export type Result = StepResult<BountyState>;
export type Step = (ctx: Ctx) => Promise<Result>;

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function utcLabel(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

/** c1 budget, c2 photo evidence with the rubric, c3 deadline. Built in code, never by the model. */
export function baseClauses(input: { amount: Money; rubric: string; deadline: string; who: "pool" | "pledge" }): Clause[] {
  return [
    {
      id: "c1",
      kind: "budget_max",
      label: input.who === "pool" ? `Pays out no more than ${formatMoney(input.amount)}` : `Charge me no more than ${formatMoney(input.amount)}`,
      amount: input.amount,
    },
    {
      id: "c2",
      kind: "require_evidence",
      label: input.who === "pool" ? "Pays only after before and after photos pass the rubric" : "Charge me only after before and after photos pass the rubric",
      evidence: "before_after_photos",
      rubric: input.rubric,
    },
    { id: "c3", kind: "expires_at", label: `Ends ${utcLabel(input.deadline)}`, at: input.deadline },
  ];
}

/** Every waiting bounty-run step checks cancel and the deadline first. */
export function closeIfDue(ctx: Ctx, bounty: Bounty, parsed: ParsedSignal): Result | null {
  if (!CLOSABLE_BOUNTY_STATUSES.includes(bounty.status)) return null;
  if (parsed.ok && parsed.signal.event === "cancel") return { next: "close", state: { closeReason: "cancelled" } };
  if (ctx.now().getTime() >= Date.parse(bounty.deadline)) return { next: "close", state: { closeReason: "expired" } };
  return null;
}

/** undefined keeps the current lastRejection; null clears it. */
function rejectionState(rejection: string | null | undefined): Partial<BountyState> {
  return rejection === undefined ? {} : { lastRejection: rejection };
}

export function waitForPledges(bounty: Bounty, funded: Money, rejection: string | null | undefined): Result {
  return {
    wait: {
      kind: "external_event",
      message: `${formatMoney(funded)} of ${formatMoney(bounty.reward)} pledged. Waiting for more backers.`,
      data: { bountyId: bounty.id, funded, reward: bounty.reward },
    },
    resumeAt: "funding",
    state: rejectionState(rejection),
  };
}

export function waitForClaim(bounty: Bounty, rejection: string | null | undefined): Result {
  return {
    wait: {
      kind: "external_event",
      message: `Funded at ${formatMoney(bounty.reward)}. Waiting for someone to claim the job.`,
      data: { bountyId: bounty.id },
    },
    resumeAt: "claim",
    state: rejectionState(rejection),
  };
}

export function waitForProof(bounty: Bounty, rejection: string | null | undefined): Result {
  const who = bounty.claim?.workerName ?? "The worker";
  return {
    wait: {
      kind: "user_upload",
      message: `${who} claimed this job. Take the before photo, do the work, then take the after photo.`,
      data: { bountyId: bounty.id, accept: "image/*", shots: bounty.shots },
    },
    resumeAt: "verify",
    state: rejectionState(rejection),
  };
}

export function waitForPayoutChoice(bounty: Bounty, rejection: string | null | undefined): Result {
  return {
    wait: {
      kind: "user_confirm",
      message: `PayPal Payouts did not go through (${bounty.failure ?? "unknown error"}). Retry the payout, or refund every backer.`,
      data: { bountyId: bounty.id, confirmLabel: "Retry payout", declineLabel: "Refund backers" },
    },
    resumeAt: "settle",
    state: rejectionState(rejection),
  };
}
