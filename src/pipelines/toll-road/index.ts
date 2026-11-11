/**
 * Toll Road: HTTP 402 metered access for AI agents, settled on PayPal.
 *
 *   setup -> compile -> [user_confirm] -> sign -> [paypal_approval] -> activate -> crawl -> settle -> payout
 *
 * Per fetch: pure guard + local meter, no PayPal call. Settlement: one final capture for the metered
 * total. Publishers: a network payout slip split by usage, paid in one Payouts batch.
 */
import { z } from "zod";
import type { PipelineDefinition, Slip, StepContext, StepResult } from "@/core/contracts";
import { appendEvent } from "@/core/events";
import { cmpMoney, formatMoney, zeroMoney } from "@/core/money";
import { createCrawlerTools, CRAWLER_MAX_STEPS, CRAWLER_SYSTEM, MOCK_SCRIPT, stopReasonOf } from "./crawler";
import { isTollSlip } from "./gateway";
import { earningsByPublisher, meterTotal, metersForSlip, metersOf, unsettled } from "./metering";
import {
  buildNetworkSlip,
  buildPayoutProposal,
  buildSettlementProposal,
  payoutReceivers,
  usageSplits,
} from "./settlement";
import { catalogEmails, prepareCatalog } from "./server";
import { COMPILER_GUIDANCE, mockCompile, withRateCard } from "./slip";
import { DEFAULT_INTENT, DEFAULT_OPERATOR, DEFAULT_QUESTION, TOLL_ROAD, type TollState } from "./types";

export const TollInputSchema = z.object({
  question: z.string().trim().min(3).max(500).optional(),
  intent: z.string().trim().min(3).max(500).optional(),
  operator: z.string().trim().min(1).max(80).optional(),
});
export type TollInput = z.infer<typeof TollInputSchema>;

type Ctx = StepContext<TollState>;
type Result = StepResult<TollState>;

export const RETURN_PATH = "/p/toll-road";

export { catalogEmails };

function mockDelayMs(ctx: Ctx): number {
  if (ctx.ai.mode !== "mock") return 0;
  const raw = process.env.TOLL_ROAD_MOCK_DELAY_MS ?? (process.env.VITEST ? "0" : "400");
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function tollSlip(ctx: Ctx): Slip {
  const id = ctx.run.state.tollSlipId;
  const slip = id ? ctx.store.slips.get(id) : null;
  if (!isTollSlip(slip)) throw new Error("This run has no toll slip.");
  return slip;
}

function reject(ctx: Ctx, slip: Slip, reason: string): void {
  if (slip.status === "rejected") return;
  ctx.store.slips.update(slip.id, { status: "rejected" });
  appendEvent(ctx.store.ledger, slip.id, "slip.status", "user", { from: slip.status, to: "rejected", reason });
}

function said(signal: unknown, key: string): boolean | null {
  if (!signal || typeof signal !== "object") return null;
  const v = (signal as Record<string, unknown>)[key];
  return typeof v === "boolean" ? v : null;
}

const steps: Record<string, (ctx: Ctx) => Promise<Result>> = {
  async setup(ctx) {
    prepareCatalog(ctx);
    return { next: "compile" };
  },

  async compile(ctx) {
    const { intent, operator, question } = ctx.run.state;
    const principal = { name: operator, email: null };
    const compiled = await ctx.core.compileSlip({
      pipeline: TOLL_ROAD,
      intent,
      principal,
      guidance: COMPILER_GUIDANCE,
      mock: () => mockCompile(intent, ctx.now()),
    });
    const slip = ctx.core.createSlip({
      pipeline: TOLL_ROAD,
      principal,
      intent,
      clauses: withRateCard(compiled.clauses, intent),
      budget: compiled.budget,
      expiresAt: compiled.expiresAt,
      meta: { role: "toll", runId: ctx.run.id, question, summary: compiled.summary },
    });
    return {
      wait: {
        kind: "user_confirm",
        message: `Read the toll slip. ${compiled.summary} Sign it to let the research agent pay per fetch.`,
        data: { slipId: slip.id, confirmLabel: "Sign this toll slip", declineLabel: "Don't sign" },
      },
      resumeAt: "sign",
      slipId: slip.id,
      state: { tollSlipId: slip.id, summary: compiled.summary },
    };
  },

  async sign(ctx) {
    const slip = tollSlip(ctx);
    const ok = said(ctx.signal, "confirmed") ?? said(ctx.signal, "approved");
    if (ok !== true) {
      reject(ctx, slip, "The operator chose not to sign the toll slip.");
      return { done: true, state: { outcome: "declined" } };
    }
    const { approveUrl, orderId } = await ctx.core.beginSigning(slip.id, { intent: "AUTHORIZE", returnPath: RETURN_PATH });
    return {
      wait: {
        kind: "paypal_approval",
        message: `Sign with PayPal. PayPal holds ${formatMoney(slip.budget)}; nothing is charged until the agent's fetches settle.`,
        data: { approveUrl, orderId },
      },
      resumeAt: "activate",
      state: { approveUrl, orderId },
    };
  },

  async activate(ctx) {
    const slip = tollSlip(ctx);
    if (said(ctx.signal, "approved") !== true) {
      reject(ctx, slip, "PayPal approval was cancelled.");
      return { done: true, state: { outcome: "not_signed" } };
    }
    await ctx.core.completeSigning(slip.id);
    return { next: "crawl" };
  },

  async crawl(ctx) {
    const slip = tollSlip(ctx);
    const { tools, session } = createCrawlerTools({
      gateway: { store: ctx.store, guard: ctx.guard, now: () => ctx.now(), baseUrl: ctx.baseUrl },
      ai: ctx.ai,
      slipId: slip.id,
      delayMs: mockDelayMs(ctx),
    });
    const result = await ctx.ai.runAgent({
      label: "toll-road.crawler",
      tier: "smart",
      system: CRAWLER_SYSTEM,
      task: `Research question: ${ctx.run.state.question}\nStart with list_catalog, fetch what you need, then call finish.`,
      tools,
      maxSteps: CRAWLER_MAX_STEPS,
      mock: MOCK_SCRIPT,
      onStep: (step) => {
        if (step.kind === "message") appendEvent(ctx.store.ledger, slip.id, "agent.step", "agent", { label: "toll-road.crawler", step });
      },
    });
    const stopReason = stopReasonOf(session);
    const needsNewSlip = stopReason === "budget_exhausted" || stopReason === "slip_expired";
    const answer = session.finished?.answer ?? (result.finalText.trim() || null);
    const citations = session.finished?.citations ?? [];
    const paid = session.attempts.filter((a) => a.outcome === "paid").length;
    const refused = session.attempts.filter((a) => a.outcome === "refused").length;
    ctx.store.ledger.append(slip.id, "toll-road.crawl_finished", "agent", {
      message: needsNewSlip
        ? `Crawler stopped (${stopReason.replace(/_/g, " ")}) after ${paid} paid fetches; it asks the operator to sign a new slip.`
        : `Crawler finished after ${paid} paid fetches.`,
      stopReason,
      paid,
      refused,
      citations,
      needsNewSlip,
    });
    return {
      next: "settle",
      state: {
        attempts: session.attempts,
        answer,
        citations,
        droppedCitations: session.finished?.dropped ?? [],
        stopReason,
        needsNewSlip,
      },
    };
  },

  async settle(ctx) {
    const slip = tollSlip(ctx);
    const meters = unsettled(metersForSlip(ctx.store, slip.id));
    const currency = slip.budget.currency;
    if (meters.length === 0) {
      await ctx.core.releaseRemainder(slip.id);
      ctx.store.ledger.append(slip.id, "toll-road.settled", "system", {
        message: "Nothing was fetched, so nothing was captured. The whole hold was released.",
        captureId: null,
        total: zeroMoney(currency),
        fetches: 0,
        byPublisher: [],
      });
      return { done: true, state: { outcome: "nothing_to_settle", meterTotal: zeroMoney(currency) } };
    }

    const proposal = buildSettlementProposal(slip, meters);
    const total = meterTotal(meters, currency);
    if (cmpMoney(proposal.amount, total) !== 0) {
      return { fail: `Settlement items add up to ${formatMoney(proposal.amount)}, but the meters total ${formatMoney(total)}.` };
    }

    let outcome: Awaited<ReturnType<typeof ctx.core.settlePurchase>>;
    try {
      outcome = await ctx.core.settlePurchase(slip.id, proposal, { finalCapture: true });
    } catch (e) {
      return { fail: `PayPal capture failed: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (outcome.verdict.decision !== "within" || !outcome.captureId) {
      await ctx.core.releaseRemainder(slip.id);
      const why = outcome.verdict.violations.map((v) => `${v.clauseId}: ${v.message}`).join("; ") || "the guard did not approve it";
      return { fail: `Settlement refused by the guard (${why}). The hold was released and the meters stay unsettled.` };
    }
    const captureId = outcome.captureId;
    await ctx.core.releaseRemainder(slip.id);

    const col = metersOf(ctx.store);
    for (const m of meters) col.put(m.id, { ...m, settled: true, captureId });
    const earnings = earningsByPublisher(meters, currency);
    ctx.store.ledger.append(slip.id, "toll-road.settled", "system", {
      message: `One capture of ${formatMoney(total)} settles ${meters.length} metered fetches.`,
      captureId,
      total,
      fetches: meters.length,
      byPublisher: earnings,
    });
    return { next: "payout", state: { captureId, meterTotal: total, earnings } };
  },

  async payout(ctx) {
    const toll = tollSlip(ctx);
    const { captureId, earnings } = ctx.run.state;
    if (!captureId || earnings.length === 0) return { fail: "Nothing was captured, so there is nothing to pay out." };

    const network = ctx.core.createSlip(buildNetworkSlip({ tollSlip: toll, captureId, earnings, now: ctx.now() }));
    ctx.store.slips.update(network.id, { status: "active" });
    appendEvent(ctx.store.ledger, network.id, "slip.status", "system", {
      from: network.status,
      to: "active",
      reason: `Funded by capture ${captureId} on toll slip ${toll.id}.`,
    });
    const freshToll = ctx.store.slips.get(toll.id) ?? toll;
    ctx.store.slips.update(toll.id, { meta: { ...freshToll.meta, networkSlipId: network.id } });

    const splits = usageSplits(earnings);
    const active = ctx.store.slips.get(network.id) ?? network;
    const res = await ctx.core.settlePayout(network.id, buildPayoutProposal(active, earnings), payoutReceivers(earnings));
    if (res.verdict.decision !== "within" || !res.payoutBatchId) {
      const why = res.verdict.violations.map((v) => `${v.clauseId}: ${v.message}`).join("; ") || "the guard did not approve it";
      return { fail: `Publisher payout refused by the guard (${why}).` };
    }
    const data = {
      message: `Paid ${earnings.length} publishers by usage: ${earnings.map((e) => `${e.name} ${formatMoney(e.total)}`).join(", ")}.`,
      payoutBatchId: res.payoutBatchId,
      networkSlipId: network.id,
      tollSlipId: toll.id,
      splits,
      items: payoutReceivers(earnings),
    };
    ctx.store.ledger.append(network.id, "toll-road.payout_split", "system", data);
    ctx.store.ledger.append(toll.id, "toll-road.payout_split", "system", data);
    return { done: true, state: { networkSlipId: network.id, payoutBatchId: res.payoutBatchId, splits, outcome: "paid" } };
  },
};

const definition: PipelineDefinition<TollInput, TollState> = {
  id: TOLL_ROAD,
  title: "Toll Road",
  tagline: "AI agents pay publishers per fetch behind an HTTP 402 toll booth, under a slip you sign, settled on PayPal.",
  primitives: [
    "HTTP 402",
    "Orders v2 AUTHORIZE",
    "Payments v2 final capture",
    "Payouts v1",
    "Pure guard per fetch",
    "Tool-using AI agent",
    "Quarantined reader",
  ],
  input: TollInputSchema,
  initialState: (input) => ({
    question: input.question ?? DEFAULT_QUESTION,
    intent: input.intent ?? DEFAULT_INTENT,
    operator: input.operator ?? DEFAULT_OPERATOR,
    tollSlipId: null,
    summary: null,
    orderId: null,
    approveUrl: null,
    attempts: [],
    answer: null,
    citations: [],
    droppedCitations: [],
    stopReason: null,
    needsNewSlip: false,
    meterTotal: null,
    captureId: null,
    earnings: [],
    networkSlipId: null,
    payoutBatchId: null,
    splits: [],
    outcome: null,
  }),
  firstStep: "setup",
  steps,
};

export default definition;
