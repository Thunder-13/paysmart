/**
 * confirm_slip: wait for Ana's in-app signature (no PayPal order: payouts come from her balance).
 * pay: sign or decline; on sign, one guarded Payouts batch. core.settlePayout checks EVERY receiver
 *      against payee_allowlist, split_rule, budget_max and expires_at and pays nobody if any fails.
 * payout_status: read the batch back once and show what PayPal says.
 */
import { z } from "zod";
import type { NewProposal, RunWait, StepContext, StepResult } from "@/core/contracts";
import { formatMoney, sumMoney, toCents } from "@/core/money";
import type { CashWeatherState, PayoutLine } from "../types";

type Ctx = StepContext<CashWeatherState>;
type Res = StepResult<CashWeatherState>;

export const SlipSignalSchema = z.union([z.object({ action: z.enum(["sign", "decline"]) }), z.object({ approved: z.boolean() })]);

export function slipWait(s: CashWeatherState, problem: string | null): RunWait {
  const give = s.give!;
  const n = give.payouts.length;
  const base = `Sign the patronage slip: give ${formatMoney(give.budget)} to ${n} maintainer${n === 1 ? "" : "s"} through PayPal Payouts, paid from your business balance.`;
  return {
    kind: "user_confirm",
    message: problem ? `${problem}. ${base}` : base,
    data: { confirmLabel: "Sign and pay", declineLabel: "Not this month", slipId: s.slipId },
  };
}

export function payoutNote(p: PayoutLine, principal: string): string {
  return `Thank you for maintaining ${p.packages.join(", ")}. From ${principal} via PaySmart.`.slice(0, 1000);
}

export async function confirmSlipStep(ctx: Ctx): Promise<Res> {
  const s = ctx.run.state;
  if (!s.slipId || !s.give) return { fail: "confirm_slip ran before the slip existed" };
  if (toCents(s.give.budget) === 0 || s.give.payouts.length === 0) {
    await ctx.core.releaseRemainder(s.slipId);
    return { done: true, state: { outcome: "no_room" } };
  }
  return { wait: slipWait(s, null), resumeAt: "pay", state: { waitError: null } };
}

export async function payStep(ctx: Ctx): Promise<Res> {
  const s = ctx.run.state;
  if (!s.slipId || !s.give) return { fail: "pay ran before the slip existed" };
  const slipId = s.slipId;
  const parsed = SlipSignalSchema.safeParse(ctx.signal);
  if (!parsed.success) {
    const problem = "Signature not understood: send {action: \"sign\"} or {action: \"decline\"}";
    return { wait: slipWait(s, problem), resumeAt: "pay", state: { waitError: problem } };
  }
  const sign = "action" in parsed.data ? parsed.data.action === "sign" : parsed.data.approved;
  const slip = ctx.store.slips.get(slipId);
  if (!slip) return { fail: `Slip ${slipId} is missing` };
  const principal = s.input.principal.name;

  if (!sign) {
    ctx.store.slips.update(slipId, { status: "rejected" });
    ctx.store.ledger.append(slipId, "slip.status", "user", { from: slip.status, to: "rejected", reason: "Declined in the app. Nothing is paid this month." });
    return { done: true, state: { outcome: "declined", waitError: null } };
  }

  const at = ctx.now().toISOString();
  ctx.store.slips.update(slipId, { status: "active", meta: { ...slip.meta, signedInApp: { at, by: principal, method: "in_app_confirm" } } });
  ctx.store.ledger.append(slipId, "slip.status", "user", {
    from: slip.status,
    to: "active",
    reason: `Signed in the app by ${principal} (in_app_confirm). Payouts come from the business balance, so no PayPal order is needed.`,
  });

  const items = s.give.payouts.map((p) => ({ receiverEmail: p.email, amount: p.amount, note: payoutNote(p, principal) }));
  const proposal: NewProposal = {
    slipId,
    kind: "payout",
    amount: sumMoney(
      items.map((i) => i.amount),
      "USD",
    ),
    payee: null,
    items: [],
    evidence: [],
    rationale: `Upstream patronage for ${items.length} maintainers, split by how much the code uses each package.`,
  };
  let result: Awaited<ReturnType<typeof ctx.core.settlePayout>>;
  try {
    result = await ctx.core.settlePayout(slipId, proposal, items);
  } catch (e) {
    return { fail: `PayPal Payouts failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  const payout = { verdict: result.verdict, payoutBatchId: result.payoutBatchId, status: null, items: [] };
  if (result.verdict.decision !== "within" || !result.payoutBatchId) {
    return { done: true, state: { outcome: "blocked", payout, waitError: null } };
  }
  return { next: "payout_status", state: { payout, waitError: null } };
}

export async function payoutStatusStep(ctx: Ctx): Promise<Res> {
  const s = ctx.run.state;
  const batchId = s.payout?.payoutBatchId;
  if (!s.slipId || !s.payout || !batchId) return { fail: "payout_status ran without a payout batch" };
  try {
    const res = await ctx.rail.getPayout(batchId);
    ctx.store.ledger.append(s.slipId, "cash-weather.payout_status", "rail", {
      message: `Payout batch ${batchId}: ${res.status} (${res.items.length} item${res.items.length === 1 ? "" : "s"})`,
      payoutBatchId: batchId,
      status: res.status,
      items: res.items,
    });
    return { done: true, state: { outcome: "paid", payout: { ...s.payout, status: res.status, items: res.items } } };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    ctx.store.ledger.append(s.slipId, "cash-weather.payout_status", "rail", {
      message: `Payout batch ${batchId} was created; reading its status failed (${error.slice(0, 200)})`,
      payoutBatchId: batchId,
    });
    return { done: true, state: { outcome: "paid" } };
  }
}
