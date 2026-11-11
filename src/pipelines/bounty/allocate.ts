/**
 * Splits the reward across signed pledges in signing order. Pledges past the reward get 0.00 and
 * are voided instead of captured, which trims an over-pledge race at capture time.
 */
import type { Money } from "@/core/contracts";
import { fromCents, toCents } from "@/core/money";

export interface PledgeForAllocation {
  slipId: string;
  budget: Money;
  signedAt: string;
}

export interface Allocation {
  slipId: string;
  amount: Money;
}

export function sortBySigning<T extends { slipId: string; signedAt: string }>(pledges: T[]): T[] {
  return [...pledges].sort((a, b) => a.signedAt.localeCompare(b.signedAt) || a.slipId.localeCompare(b.slipId));
}

export function allocate(reward: Money, pledges: PledgeForAllocation[]): Allocation[] {
  let left = toCents(reward);
  return sortBySigning(pledges).map((p) => {
    const take = Math.max(0, Math.min(toCents(p.budget), left));
    left -= take;
    return { slipId: p.slipId, amount: fromCents(take, reward.currency) };
  });
}
