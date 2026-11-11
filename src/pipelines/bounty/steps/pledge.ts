/**
 * Pledge run: one backer's slip, signed with a PayPal AUTHORIZE order. Money is held, never
 * captured here. The page nudges the bounty run afterwards; the bounty run recounts from slips.
 */
import { cmpMoney, formatMoney, minMoney, money, subMoney } from "@/core/money";
import { bounties, bountyEvent, fundedTotal, setSlipStatus } from "../records";
import { CLOSED_BOUNTY_STATUSES, PLEDGE_MIN, PledgeSignalSchema } from "../schema";
import { baseClauses, type Step } from "./shared";

export const pledgeStart: Step = async (ctx) => {
  const input = ctx.run.state.pledge;
  if (!input) return { fail: "This run has no pledge input." };
  const bounty = bounties(ctx.store).get(input.bountyId);
  if (!bounty) return { fail: `No bounty ${input.bountyId}.` };
  const now = ctx.now();
  if (bounty.status !== "funding") return { fail: `"${bounty.title}" is not taking pledges (it is ${bounty.status}).` };
  if (now.getTime() >= Date.parse(bounty.deadline)) return { fail: `"${bounty.title}" is not taking pledges (its deadline passed).` };
  if (input.amount.currency.toUpperCase() !== bounty.reward.currency.toUpperCase()) {
    return { fail: `amount: pledges to this bounty are in ${bounty.reward.currency}.` };
  }
  if (cmpMoney(input.amount, money(PLEDGE_MIN, bounty.reward.currency)) < 0) return { fail: `amount: pledges start at ${formatMoney(money(PLEDGE_MIN))}.` };

  const remaining = subMoney(bounty.reward, fundedTotal(ctx.store, bounty));
  if (cmpMoney(remaining, money(0, bounty.reward.currency)) <= 0) {
    return { fail: `"${bounty.title}" is already covered, so it is not taking pledges.` };
  }
  const amount = minMoney(input.amount, remaining);

  const slip = ctx.core.createSlip({
    pipeline: "bounty",
    principal: { name: input.backer.name, email: input.backer.email },
    intent: `Back "${bounty.title}" with ${formatMoney(amount)}. Charge me only if before and after photos pass the rubric.`,
    clauses: baseClauses({ amount, rubric: bounty.rubric, deadline: bounty.deadline, who: "pledge" }),
    budget: amount,
    expiresAt: bounty.deadline,
    meta: { role: "pledge", bountyId: bounty.id, requested: input.amount },
  });
  const { approveUrl, orderId } = await ctx.core.beginSigning(slip.id, {
    intent: "AUTHORIZE",
    returnPath: `/p/bounty?bounty=${encodeURIComponent(bounty.id)}`,
  });
  return {
    wait: {
      kind: "paypal_approval",
      message: `Sign with PayPal to hold ${formatMoney(amount)} for "${bounty.title}". Nothing is charged unless the proof passes.`,
      data: { approveUrl, orderId, bountyId: bounty.id, amount, requested: input.amount },
    },
    resumeAt: "pledge_signed",
    slipId: slip.id,
    state: { pledgeSlipId: slip.id, pledgeAmount: amount },
  };
};

export const pledgeSigned: Step = async (ctx) => {
  const { pledgeSlipId, bountyId } = ctx.run.state;
  const slip = pledgeSlipId ? ctx.store.slips.get(pledgeSlipId) : null;
  if (!slip || !bountyId) return { fail: "This pledge run lost its slip." };
  const parsed = PledgeSignalSchema.safeParse(ctx.signal);
  if (!parsed.success) {
    return {
      wait: {
        kind: "paypal_approval",
        message: "Still waiting for the PayPal signature.",
        data: { approveUrl: slip.rail.approveUrl, orderId: slip.rail.orderId, bountyId },
      },
      resumeAt: "pledge_signed",
    };
  }
  if (!parsed.data.approved) {
    setSlipStatus(ctx.store, slip, "rejected", "The backer cancelled on PayPal.");
    return { done: true, state: { outcome: "declined" } };
  }

  const signed = await ctx.core.completeSigning(slip.id);
  const now = ctx.now();
  ctx.store.slips.update(slip.id, { meta: { ...signed.meta, signedAt: now.toISOString() } });

  const bounty = bounties(ctx.store).get(bountyId);
  const closed = !bounty || CLOSED_BOUNTY_STATUSES.includes(bounty.status) || now.getTime() >= Date.parse(bounty.deadline);
  if (closed) {
    await ctx.core.releaseRemainder(slip.id);
    if (bounty) {
      bountyEvent(ctx.store, bounty.payoutSlipId, "bounty.pledge_voided", "system", {
        message: `${slip.principal.name} signed ${formatMoney(slip.budget)} after the bounty closed; the hold was voided.`,
        pledgeSlipId: slip.id,
        backer: slip.principal.name,
        amount: slip.budget,
        reason: `The bounty is ${now.getTime() >= Date.parse(bounty.deadline) && bounty.status === "funding" ? "past its deadline" : bounty.status}, so the hold was voided at once.`,
      });
    }
    return { done: true, state: { outcome: "voided_late" } };
  }
  bountyEvent(ctx.store, bounty.payoutSlipId, "bounty.pledged", "user", {
    message: `${slip.principal.name} pledged ${formatMoney(slip.budget)}; PayPal holds it until the proof passes.`,
    pledgeSlipId: slip.id,
    backer: slip.principal.name,
    amount: slip.budget,
  });
  return { done: true, state: { outcome: "held" } };
};
