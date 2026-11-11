/**
 * Second Look: before you pay a stranger, read the chat, name the scam tactics, and move the money
 * onto a guarded, protected goods payment with tracking evidence.
 *
 *   analyze -> compile -[user_confirm]-> offer_decision -[external_event seller_response]-> seller_decision
 *     -> guard_payment -> sign -[paypal_approval]-> capture -[external_event shipment]-> shipment -> done
 *
 * Every wait validates its resume payload; a bad payload re-waits on the same step (see design.md, Step graph).
 */
import type { PipelineDefinition, RunWait, SlipStatus, StepContext, StepResult } from "@/core/contracts";
import { appendEvent } from "@/core/events";
import { formatMoney } from "@/core/money";
import { isPayPalError } from "@/core/rail/errors";
import { analyzeConversation } from "./analyze";
import { writeAlert } from "./family";
import { recordHandoff } from "./handoff";
import {
  BUYER_WALKED_AWAY_TEXT,
  HANDED_OFF_TEXT,
  PAYMENT_CANCELLED_TEXT,
  PROTECTED_SHIPPED_TEXT,
  WALK_AWAY_TEXT,
  blockedText,
  honestOffer,
  payeeBlockedText,
  shippedUnconfirmedText,
} from "./offer";
import { buildPaymentProposal, buildSlip } from "./slip";
import { ALERT_AT, CARRIERS, CLAUSE_IDS, RETURN_PATH, TACTIC_LABELS } from "./taxonomy";
import { titleOf } from "./text";
import {
  ApprovalSignalSchema,
  OfferSignalSchema,
  SecondLookInputSchema,
  SellerSignalSchema,
  ShipmentSignalSchema,
  type AlertReason,
  type SecondLookInput,
  type SecondLookState,
} from "./types";

type Ctx = StepContext<SecondLookState>;
type Result = StepResult<SecondLookState>;
type EventType = `second-look.${string}`;

const NOT_UNDERSTOOD = "That response wasn't understood.";

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function slipIdOf(ctx: Ctx): string {
  if (!ctx.run.slipId) throw new Error("This run has no slip yet.");
  return ctx.run.slipId;
}

function record(ctx: Ctx, type: EventType, actor: "user" | "agent" | "system" | "webhook", data: Record<string, unknown>): void {
  ctx.store.ledger.append(slipIdOf(ctx), type, actor, { runId: ctx.run.id, ...data });
}

/** Closes an unsigned slip (draft or awaiting signature). Signed slips are left to the core. */
function closeSlip(ctx: Ctx, reason: string, to: SlipStatus = "rejected"): void {
  const slip = ctx.store.slips.get(slipIdOf(ctx));
  if (!slip || !["draft", "awaiting_signature"].includes(slip.status)) return;
  ctx.store.slips.update(slip.id, { status: to });
  appendEvent(ctx.store.ledger, slip.id, "slip.status", "system", { from: slip.status, to, reason });
}

function sendAlert(ctx: Ctx, slipId: string, reason: AlertReason): string[] {
  const { input, analysis, alertIds } = ctx.run.state;
  const alert = writeAlert(
    ctx.store,
    {
      to: input.trustedContactEmail,
      slipId,
      runId: ctx.run.id,
      reason,
      riskScore: analysis?.riskScore ?? 0,
      band: analysis?.band ?? "low",
      headline: analysis?.headline ?? "",
      tactics: (analysis?.tactics ?? []).map((t) => ({ id: t.id, label: t.label, quote: t.quote })),
      buyerName: input.principal.name,
      sellerEmail: input.sellerEmail,
      amount: input.amount,
    },
    ctx.now(),
  );
  if (!alert || alertIds.includes(alert.id)) return alertIds;
  ctx.store.ledger.append(slipId, "second-look.alert_sent", "system", {
    runId: ctx.run.id,
    message: `Family alert sent to ${alert.to} (${reason === "high_risk" ? "high risk" : "seller refused"})`,
    alertId: alert.id,
    reason,
  });
  return [...alertIds, alert.id];
}

/* ---------------------------------------------------------------- waits */

function offerWait(state: SecondLookState, notice?: string): RunWait {
  return {
    kind: "user_confirm",
    message: notice ?? "Read the risk card, then send the seller the honest offer or walk away.",
    data: {
      stage: "offer",
      honestOffer: state.honestOffer,
      riskScore: state.analysis?.riskScore ?? null,
      band: state.analysis?.band ?? null,
      confirmLabel: "Send the honest offer",
      declineLabel: "Walk away",
    },
  };
}

function sellerWait(state: SecondLookState, notice?: string): RunWait {
  return {
    kind: "external_event",
    message: notice ?? "Waiting for the seller to answer the honest offer.",
    data: { event: "seller_response", honestOffer: state.honestOffer },
  };
}

function approvalWait(state: SecondLookState, notice?: string): RunWait {
  return {
    kind: "paypal_approval",
    message:
      notice ??
      `Sign with PayPal to pay ${state.input.sellerEmail} ${formatMoney(state.input.amount)} as a protected goods payment.`,
    data: { approveUrl: state.approveUrl, orderId: state.orderId },
  };
}

function shipmentWait(state: SecondLookState, notice?: string): RunWait {
  return {
    kind: "external_event",
    message: notice ?? "Paid and protected. Waiting for the seller to ship.",
    data: { event: "shipment", carriers: [...CARRIERS], orderId: state.orderId, captureId: state.captureId },
  };
}

function rewait(wait: RunWait, step: string): Result {
  return { wait, resumeAt: step, state: { notice: wait.message } };
}

function finish(state: Partial<SecondLookState>): Result {
  return { done: true, state: { notice: null, ...state } };
}

/* ---------------------------------------------------------------- steps */

const steps: PipelineDefinition<SecondLookInput, SecondLookState>["steps"] = {
  async analyze(ctx) {
    const analysis = await analyzeConversation({ ai: ctx.ai, blobs: ctx.store.blobs }, ctx.run.state.input);
    return { next: "compile", state: { analysis } };
  },

  async compile(ctx) {
    const state = ctx.run.state;
    const analysis = state.analysis;
    const slip = ctx.core.createSlip(buildSlip(state.input, { now: ctx.now(), listingTitle: state.listingTitle, analysis }));
    ctx.store.ledger.append(slip.id, "second-look.analyzed", "agent", {
      runId: ctx.run.id,
      message: analysis
        ? `Risk ${analysis.riskScore}/100 (${analysis.band}): ${analysis.tactics.map((t) => TACTIC_LABELS[t.id]).join(", ") || "no scam signs"}`
        : "No analysis",
      riskScore: analysis?.riskScore ?? null,
      modelScore: analysis?.modelScore ?? null,
      floor: analysis?.floor ?? null,
      band: analysis?.band ?? null,
      injectionSuspected: analysis?.injectionSuspected ?? false,
      notes: analysis?.notes ?? [],
      tactics: (analysis?.tactics ?? []).map((t) => ({ id: t.id, quote: t.quote, source: t.source })),
    });
    // The run has no slipId until this step returns, so alerts take the new slip's id directly.
    const alertIds = analysis && analysis.riskScore >= ALERT_AT ? sendAlert(ctx, slip.id, "high_risk") : state.alertIds;
    const next = { ...state, alertIds };
    return { wait: offerWait(next), resumeAt: "offer_decision", slipId: slip.id, state: { alertIds, notice: null } };
  },

  async offer_decision(ctx) {
    const state = ctx.run.state;
    const parsed = OfferSignalSchema.safeParse(ctx.signal);
    if (!parsed.success) {
      return rewait(offerWait(state, `${NOT_UNDERSTOOD} Send the honest offer or walk away.`), "offer_decision");
    }
    const send = "action" in parsed.data ? parsed.data.action === "send_offer" : parsed.data.approved;
    if (!send) {
      closeSlip(ctx, "The buyer chose not to pay.");
      record(ctx, "second-look.buyer_walked_away", "user", { message: "Buyer walked away before paying" });
      return finish({ outcome: "buyer_walked_away", recommendation: BUYER_WALKED_AWAY_TEXT });
    }
    record(ctx, "second-look.offer_sent", "user", { message: "Buyer sent the honest offer", honestOffer: state.honestOffer });
    return { wait: sellerWait(state), resumeAt: "seller_decision", state: { notice: null } };
  },

  async seller_decision(ctx) {
    const state = ctx.run.state;
    const parsed = SellerSignalSchema.safeParse(ctx.signal);
    if (!parsed.success) {
      return rewait(sellerWait(state, `${NOT_UNDERSTOOD} Did the seller accept or refuse the protected payment?`), "seller_decision");
    }
    const answer = parsed.data;
    if (answer.response === "refused") {
      closeSlip(ctx, "The seller refused a protected payment.");
      record(ctx, "second-look.seller_refused", "user", {
        message: "Seller refused a protected payment",
        note: answer.note ?? null,
      });
      const alertIds = sendAlert(ctx, slipIdOf(ctx), "seller_refused");
      return finish({ outcome: "seller_refused", recommendation: WALK_AWAY_TEXT, alertIds });
    }
    const requested = answer.payeeEmail && answer.payeeEmail !== state.input.sellerEmail ? answer.payeeEmail : null;
    record(ctx, "second-look.seller_accepted", "user", {
      message: requested ? `Seller accepted but asked to be paid at ${requested}` : "Seller accepted a protected payment",
      payeeEmail: requested,
    });
    return { next: "guard_payment", state: { requestedPayee: requested, notice: null } };
  },

  async guard_payment(ctx) {
    const state = ctx.run.state;
    const slipId = slipIdOf(ctx);
    const payee = state.requestedPayee ?? state.input.sellerEmail;
    const verdict = ctx.core.evaluate(
      slipId,
      buildPaymentProposal(state.input, { slipId, listingTitle: state.listingTitle, payeeEmail: payee }),
    );
    // D6: tracking can only exist after payment, so the evidence clause is pending here, never blocking.
    const blocking = verdict.violations.filter((v) => v.clauseId !== CLAUSE_IDS.evidence);
    if (blocking.length === 0) return { next: "sign", state: { verdict } };

    const payeeHit = blocking.some((v) => v.clauseId === CLAUSE_IDS.payee);
    const expired = !payeeHit && blocking.every((v) => v.clauseId === CLAUSE_IDS.expiry);
    closeSlip(
      ctx,
      payeeHit ? "The guard stopped a payment to a different account." : "The guard stopped the payment.",
      expired ? "expired" : "rejected",
    );
    record(ctx, "second-look.payment_blocked", "system", {
      message: payeeHit ? `Stopped: ${payee} is not the seller on this slip` : "Stopped by the guard before any order",
      violations: blocking,
    });
    return finish({
      verdict,
      outcome: payeeHit ? "payee_blocked" : "blocked",
      recommendation: payeeHit ? payeeBlockedText(payee, state.input.sellerEmail) : blockedText(blocking.map((v) => v.message)),
    });
  },

  async sign(ctx) {
    const state = ctx.run.state;
    const slipId = slipIdOf(ctx);
    try {
      const { approveUrl, orderId } = await ctx.core.beginSigning(slipId, {
        intent: "CAPTURE",
        payee: { email: state.input.sellerEmail },
        returnPath: RETURN_PATH,
      });
      const next = { ...state, approveUrl, orderId };
      return { wait: approvalWait(next), resumeAt: "capture", state: { approveUrl, orderId, notice: null } };
    } catch (e) {
      const issue = isPayPalError(e) && e.issue ? ` (${e.issue})` : "";
      return {
        fail: `PayPal would not create a payment to ${state.input.sellerEmail}${issue}. Check that this email belongs to a PayPal account. Details: ${errorText(e)}`,
      };
    }
  },

  async capture(ctx) {
    const state = ctx.run.state;
    const slipId = slipIdOf(ctx);
    const parsed = ApprovalSignalSchema.safeParse(ctx.signal);
    if (!parsed.success) return rewait(approvalWait(state, `${NOT_UNDERSTOOD} Finish signing with PayPal.`), "capture");
    if (!parsed.data.approved) {
      closeSlip(ctx, "The buyer cancelled on PayPal.");
      record(ctx, "second-look.payment_cancelled", "user", { message: "Buyer cancelled on PayPal; nothing moved" });
      return finish({ outcome: "payment_cancelled", recommendation: PAYMENT_CANCELLED_TEXT });
    }
    if (!state.orderId || parsed.data.orderId !== state.orderId) {
      record(ctx, "second-look.approval_ignored", "system", {
        message: "Ignored an approval for a different PayPal order",
        orderId: parsed.data.orderId ?? null,
      });
      return rewait(approvalWait(state, "That approval was for a different PayPal order, so nothing was captured. Sign the payment shown here."), "capture");
    }
    const order = await ctx.rail.getOrder(state.orderId);
    if (order.status !== "APPROVED" && order.status !== "COMPLETED") {
      return rewait(approvalWait(state, `PayPal shows this payment as ${order.status}, not approved yet. Sign it with PayPal first.`), "capture");
    }
    let captureId: string | null;
    try {
      const slip = await ctx.core.completeSigning(slipId);
      captureId = slip.rail.captureIds[slip.rail.captureIds.length - 1] ?? null;
    } catch (e) {
      return { fail: `PayPal could not complete the payment to ${state.input.sellerEmail}. Details: ${errorText(e)}` };
    }
    if (!captureId) return { fail: "PayPal approved the order, but no capture came back." };
    const next = { ...state, captureId };
    return { wait: shipmentWait(next), resumeAt: "shipment", state: { captureId, notice: null } };
  },

  async shipment(ctx) {
    const state = ctx.run.state;
    const slipId = slipIdOf(ctx);
    const parsed = ShipmentSignalSchema.safeParse(ctx.signal);
    if (!parsed.success) {
      const hint = parsed.error.issues[0]?.message;
      return rewait(shipmentWait(state, `${NOT_UNDERSTOOD} ${hint && !/^Invalid/.test(hint) ? hint : "Enter the tracking number and carrier."}`), "shipment");
    }
    if (parsed.data.event === "not_arrived") {
      const handoff = recordHandoff(ctx.store, ctx.run, ctx.now());
      return finish({ outcome: "handed_off", handoffId: handoff.id, recommendation: HANDED_OFF_TEXT });
    }
    const { trackingNumber, carrier } = parsed.data;
    const captureId = state.captureId;
    if (!captureId || !state.orderId) return { fail: "There is no captured payment to attach tracking to." };
    try {
      await ctx.rail.addTracking({ orderId: state.orderId, captureId, trackingNumber, carrier, notifyPayer: false });
    } catch (e) {
      const error = errorText(e);
      ctx.core.addEvidence(slipId, {
        kind: "tracking",
        verdict: "unknown",
        detail: `${carrier} ${trackingNumber}. PayPal did not accept it: ${error}`.slice(0, 500),
        ref: trackingNumber,
      });
      record(ctx, "second-look.tracking_failed", "system", { message: "PayPal did not accept the tracking number", error });
      return finish({
        outcome: "shipped_unconfirmed",
        tracking: { number: trackingNumber, carrier, confirmed: false },
        recommendation: shippedUnconfirmedText(isPayPalError(e) && e.issue ? e.issue : "see the ledger"),
      });
    }
    appendEvent(ctx.store.ledger, slipId, "rail.tracking_added", "rail", { captureId, trackingNumber, carrier });
    ctx.core.addEvidence(slipId, {
      kind: "tracking",
      verdict: "pass",
      detail: `${carrier} ${trackingNumber}, attached to the PayPal capture ${captureId}.`,
      ref: trackingNumber,
    });
    return finish({
      outcome: "protected_shipped",
      tracking: { number: trackingNumber, carrier, confirmed: true },
      recommendation: PROTECTED_SHIPPED_TEXT,
    });
  },
};

export function initialState(input: SecondLookInput): SecondLookState {
  const listingTitle = titleOf(input.listingText);
  return {
    input,
    analysis: null,
    listingTitle,
    honestOffer: honestOffer({ listingTitle, amount: input.amount, sellerEmail: input.sellerEmail }),
    requestedPayee: null,
    verdict: null,
    orderId: null,
    approveUrl: null,
    captureId: null,
    tracking: null,
    alertIds: [],
    handoffId: null,
    outcome: null,
    recommendation: null,
    notice: null,
  };
}

const definition: PipelineDefinition<SecondLookInput, SecondLookState> = {
  id: "second-look",
  title: "Second Look",
  tagline:
    "Before you pay a stranger, it reads the chat, names the scam tactics, and turns a risky send into a protected goods payment.",
  primitives: [
    "Orders v2 CAPTURE to payee email",
    "Shipment tracking",
    "Claude vision",
    "Structured output, no tools",
    "Phrase detectors",
    "Guard: payee allowlist",
    "Hash-chained ledger",
  ],
  input: SecondLookInputSchema,
  initialState,
  firstStep: "analyze",
  steps,
};

export default definition;
