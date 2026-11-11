/**
 * Shop pipeline steps. Graph (see openspec/changes/add-shop-pipeline/design.md):
 *   intake -> compile -> [user_confirm] confirm_slip -> sign -> [paypal_approval] complete_signing
 *   -> shop -> [user_confirm] confirm_cart -> settle -> [user_upload] verify_delivery
 *   -> refund | [user_confirm] confirm_refund -> refund | done
 */
import type { ImageInput, LedgerEventType, MockAgentScript, Money, NewProposal, Slip, StepContext, StepResult } from "@/core/contracts";
import { estimateCommission } from "@/core/affiliate";
import { appendEvent } from "@/core/events";
import { addMoney, formatMoney, fromCents, mulMoney, subMoney, sumMoney, toCents } from "@/core/money";
import { agentTask, AGENT_MAX_STEPS, AGENT_SYSTEM, mockAgentScript } from "./agent";
import { catalogSource, readChannel3Key } from "./catalog";
import { COMPILER_GUIDANCE, mockCompile, slipProblem, uncheckableAttributes, validateClauseEdits } from "./compile";
import { cleanBreaches, DELIVERY_SYSTEM, deliveryEvidenceDetail, deliveryPrompt, mockDeliveryCheck, refundDecision } from "./delivery";
import { helperEmail, payHelper, releaseHelper } from "./helper";
import { SAMPLE_PHOTO_BASE64, SAMPLE_PHOTO_CONTENT_TYPE } from "./sample-photo";
import { ShopSession } from "./tools";
import {
  ATTESTABLE_FIELDS,
  ConfirmCartSignalSchema,
  ConfirmRefundSignalSchema,
  ConfirmSlipSignalSchema,
  DeliveryCheckSchema,
  DeliverySignalSchema,
  PayPalReturnSignalSchema,
  type AffiliateRecord,
  type Attestation,
  type Outcome,
  type ShopOption,
  type ShopInput,
  type ShopState,
  type ShopTotals,
} from "./types";

export interface ShopOptions {
  /** Channel3 key lookup; defaults to process.env.CHANNEL3_API_KEY at call time. */
  channel3ApiKey?: () => string | null;
  fetch?: typeof fetch;
  /** Helper payee lookup; defaults to process.env.SHOP_HELPER_EMAIL or a placeholder. */
  helperEmail?: () => string;
  /** Test hook: replace the scripted mock agent. */
  agentScript?: (state: ShopState, slip: Slip) => MockAgentScript;
}

const ATTRIBUTED: LedgerEventType = "affiliate.attributed";
const REVERSED: LedgerEventType = "affiliate.reversed";

type Ctx = StepContext<ShopState>;
type Result = StepResult<ShopState>;

const IMAGE_TYPES: ImageInput["mediaType"][] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export function initialShopState(input: ShopInput): ShopState {
  return {
    intent: input.intent,
    principal: input.principal,
    redTeam: input.redTeam,
    hireHelper: input.hireHelper,
    catalogSource: "fixtures",
    compiled: null,
    problem: null,
    proposals: 0,
    cart: null,
    cartLines: [],
    cartVerdict: null,
    options: [],
    ruledOut: [],
    chosenOptionId: null,
    affiliate: null,
    helper: null,
    approvedVia: null,
    captureId: null,
    totals: null,
    delivery: null,
    refundId: null,
    evidencePack: null,
    outcome: null,
    note: null,
  };
}

function slipOf(ctx: Ctx): Slip {
  const id = ctx.run.slipId;
  const slip = id ? ctx.store.slips.get(id) : null;
  if (!slip) throw new Error("This run has no slip yet.");
  return slip;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Held / captured / released / refunded for the ledger panel, from the slip itself. */
export function totalsOf(slip: Slip): ShopTotals {
  const currency = slip.budget.currency;
  const authorized = slip.rail.authorizationId ? slip.budget : fromCents(0, currency);
  const closed = ["settled", "released", "refunded"].includes(slip.status);
  let refunded = 0;
  const captures = slip.meta.captures;
  if (captures && typeof captures === "object") {
    for (const c of Object.values(captures as Record<string, { refunded?: { value: string; currency: string } }>)) {
      if (c?.refunded) refunded += toCents(c.refunded);
    }
  }
  return {
    held: authorized,
    captured: slip.spent,
    released: closed && slip.rail.authorizationId ? subMoney(slip.budget, slip.spent) : fromCents(0, currency),
    refunded: fromCents(refunded, currency),
  };
}

function finish(ctx: Ctx, outcome: Outcome, state: Partial<ShopState> = {}): Result {
  const slipId = ctx.run.slipId;
  const slip = slipId ? ctx.store.slips.get(slipId) : null;
  const totals = slip ? totalsOf(slip) : null;
  if (slip) ctx.store.ledger.append(slip.id, "shop.outcome", "system", { outcome, totals, note: state.note ?? null, message: state.note ?? outcome });
  return { done: true, state: { ...state, outcome, totals } };
}

function rejectSlip(ctx: Ctx, slip: Slip, reason: string): void {
  if (slip.status === "rejected") return;
  ctx.store.slips.update(slip.id, { status: "rejected" });
  appendEvent(ctx.store.ledger, slip.id, "slip.status", "user", { from: slip.status, to: "rejected", reason });
}

/* ------------------------------------------------------------- waits */

function confirmSlipWait(slip: Slip, problem: string | null): Result {
  return {
    wait: {
      kind: "user_confirm",
      message: problem ?? "Read your slip. Edit any clause, then approve it to sign with PayPal.",
      data: {
        stage: "slip",
        summary: slip.meta.summary ?? null,
        clauses: slip.clauses,
        budget: slip.budget,
        problem,
        uncheckable: uncheckableAttributes(slip.clauses),
        confirmLabel: "Approve slip",
        declineLabel: "Tear it up",
      },
    },
    resumeAt: "confirm_slip",
    state: { problem },
  };
}

function totalsFor(amount: Money | null, helper: ShopState["helper"], slip: Slip) {
  const goods = amount ?? fromCents(0, slip.budget.currency);
  const fee = helper && helper.accepted ? helper.fee : fromCents(0, slip.budget.currency);
  const capture = addMoney(goods, fee);
  return { goods, helperFee: fee, capture, release: subMoney(slip.budget, capture) };
}

/** The options as the run state holds them; a run saved before options existed gets its one cart as option 1. */
function optionsOf(s: ShopState): ShopOption[] {
  if (s.options.length) return s.options;
  if (!s.cart || !s.cartVerdict) return [];
  return [{ id: "opt-1", rank: 1, proposal: s.cart, lines: s.cartLines, verdict: s.cartVerdict, rationale: s.cart.rationale ?? "" }];
}

function cartWait(state: ShopState, slip: Slip, problem: string | null): Result {
  const options = optionsOf(state);
  const totals = totalsFor(state.cart ? state.cart.amount : null, state.helper, slip);
  const verdict = state.cartVerdict;
  const ask = verdict?.decision === "ask";
  const selected = state.chosenOptionId ?? options[0]?.id ?? null;
  const base = ask
    ? "The guard needs your call before checkout. Confirm the missing facts, then approve."
    : options.length > 1
      ? `Choose one of ${options.length} carts the guard checked, then approve it. The selected cart captures ${formatMoney(totals.capture)} and releases ${formatMoney(totals.release)}.`
      : `Approve this cart? ${formatMoney(totals.capture)} will be captured and ${formatMoney(totals.release)} released.`;
  return {
    wait: {
      kind: "user_confirm",
      message: problem ? `${problem} ${base}` : base,
      data: {
        stage: "cart",
        options: options.map((o) => ({ ...o, totals: totalsFor(o.proposal.amount, state.helper, slip) })),
        ruledOut: state.ruledOut,
        selectedOptionId: selected,
        lines: state.cartLines,
        cart: state.cart,
        verdict,
        helper: state.helper,
        totals,
        unknowns: verdict?.unknowns ?? [],
        problem,
        confirmLabel: options.length > 1 && selected ? `Approve option ${options.find((o) => o.id === selected)?.rank ?? 1}` : "Approve cart",
        declineLabel: "Decline cart",
      },
    },
    resumeAt: "confirm_cart",
    state: { problem, cart: state.cart, cartLines: state.cartLines, cartVerdict: state.cartVerdict, chosenOptionId: selected },
  };
}

function uploadWait(problem: string | null): Result {
  return {
    wait: {
      kind: "user_upload",
      message: problem ?? "When the gift arrives, upload a photo of what came in the box (or use the sample photo).",
      data: { stage: "delivery", accept: IMAGE_TYPES.join(","), sampleAvailable: true, problem },
    },
    resumeAt: "verify_delivery",
    state: { problem },
  };
}

/** One entry per cart line that carries an affiliate link, with the estimated commission (null without a stored rate). */
function affiliateRecord(s: ShopState, slip: Slip): AffiliateRecord | null {
  const lines: AffiliateRecord["lines"] = [];
  for (const l of s.cartLines) {
    if (!l.affiliate) continue;
    const lineTotal = mulMoney(l.unitPrice, l.quantity);
    lines.push({
      listingId: l.listingId,
      network: l.affiliate.network,
      accountId: l.affiliate.accountId,
      url: l.affiliate.url,
      lineTotal,
      estCommission: estimateCommission(lineTotal, l.affiliate.commissionBps),
    });
  }
  if (!lines.length) return null;
  const rates = lines.flatMap((l) => (l.estCommission ? [l.estCommission] : []));
  return { lines, estCommission: rates.length ? sumMoney(rates, slip.budget.currency) : null, reversed: false };
}

/* ------------------------------------------------------- attestations */

function applyAttestations(cart: NewProposal, attestations: Attestation[]): { ok: true; cart: NewProposal } | { ok: false; error: string } {
  const items = cart.items.map((i) => ({ ...i, facts: { ...i.facts, attributes: { ...i.facts.attributes } } }));
  for (const a of attestations) {
    const targets = a.itemIndex === undefined ? items.map((_, i) => i) : [a.itemIndex];
    for (const idx of targets) {
      const item = items[idx];
      if (!item) return { ok: false, error: `Cart line ${a.itemIndex} does not exist.` };
      const f = item.facts;
      if (a.field.startsWith("attributes.")) {
        const name = a.field.slice("attributes.".length);
        if (!name) return { ok: false, error: "Name the attribute you are confirming." };
        if (a.itemIndex !== undefined || f.attributes[name] === undefined || f.attributes[name] === null) f.attributes[name] = a.value;
        continue;
      }
      if (!(ATTESTABLE_FIELDS as readonly string[]).includes(a.field)) return { ok: false, error: `"${a.field}" can't be confirmed here.` };
      if (a.field === "deliveryEstimate") {
        if (typeof a.value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(a.value)) return { ok: false, error: "Give the delivery date as YYYY-MM-DD." };
        if (a.itemIndex !== undefined || f.deliveryEstimate === null) f.deliveryEstimate = a.value;
      } else if (a.field === "inStock") {
        if (typeof a.value !== "boolean") return { ok: false, error: "In stock is yes or no." };
        if (a.itemIndex !== undefined || f.inStock === null) f.inStock = a.value;
      } else if (a.field === "category") {
        if (typeof a.value !== "string" || !a.value.trim()) return { ok: false, error: "Give a category." };
        if (a.itemIndex !== undefined || f.category === null) f.category = a.value.trim().toLowerCase();
      } else if (a.field === "itemCount") {
        if (typeof a.value !== "number" || !Number.isInteger(a.value) || a.value < 1) return { ok: false, error: "Units per listing is a whole number." };
        if (a.itemIndex !== undefined || f.itemCount === null) f.itemCount = a.value;
      }
    }
  }
  return { ok: true, cart: { ...cart, items } };
}

/* ---------------------------------------------------------------- steps */

export function createShopSteps(opts: ShopOptions = {}): Record<string, (ctx: Ctx) => Promise<Result>> {
  const apiKey = () => (opts.channel3ApiKey ? opts.channel3ApiKey() : readChannel3Key());
  const payee = () => (opts.helperEmail ? opts.helperEmail() : helperEmail());

  return {
    async intake() {
      return { next: "compile", state: { catalogSource: catalogSource(apiKey()) } };
    },

    async compile(ctx) {
      const s = ctx.run.state;
      const compiled = await ctx.core.compileSlip({
        pipeline: "shop",
        intent: s.intent,
        principal: s.principal,
        guidance: COMPILER_GUIDANCE,
        mock: () => mockCompile(s.intent, ctx.now()),
      });
      const slip = ctx.core.createSlip({
        pipeline: "shop",
        principal: s.principal,
        intent: s.intent,
        clauses: compiled.clauses,
        budget: compiled.budget,
        expiresAt: compiled.expiresAt,
        meta: { summary: compiled.summary, redTeam: s.redTeam, hireHelper: s.hireHelper },
      });
      ctx.store.ledger.append(slip.id, "slip.compiled", "system", { summary: compiled.summary, clauses: compiled.clauses.length });
      const wait = confirmSlipWait(slip, slipProblem(slip.clauses, slip.budget));
      return { ...wait, slipId: slip.id, state: { ...("state" in wait ? wait.state : {}), compiled } } as Result;
    },

    async confirm_slip(ctx) {
      const slip = slipOf(ctx);
      const sig = ConfirmSlipSignalSchema.safeParse(ctx.signal);
      if (!sig.success) return confirmSlipWait(slip, "Approve or decline the slip.");
      if (!sig.data.approved) {
        rejectSlip(ctx, slip, "You tore up the slip before signing.");
        return finish(ctx, "cancelled");
      }
      let current = slip;
      if (sig.data.clauses) {
        const v = validateClauseEdits(slip.clauses, sig.data.clauses);
        if (!v.ok) return confirmSlipWait(slip, v.error);
        if (v.changed) {
          current = ctx.store.slips.update(slip.id, {
            clauses: v.clauses,
            budget: v.budget,
            ...(v.expiresAt ? { expiresAt: v.expiresAt } : {}),
          });
          ctx.store.ledger.append(slip.id, "shop.clauses_edited", "user", {
            before: slip.clauses,
            after: v.clauses,
            budget: v.budget,
            message: `You edited the clauses before signing; budget ${formatMoney(v.budget)}`,
          });
        }
      }
      const problem = slipProblem(current.clauses, current.budget);
      if (problem) return confirmSlipWait(current, problem);
      return { next: "sign", state: { problem: null } };
    },

    async sign(ctx) {
      const slip = slipOf(ctx);
      const { approveUrl, orderId } = await ctx.core.beginSigning(slip.id, { intent: "AUTHORIZE", returnPath: "/p/shop" });
      return {
        wait: {
          kind: "paypal_approval",
          message: `Sign with PayPal to hold ${formatMoney(slip.budget)}. Nothing is charged until you approve a cart.`,
          data: { stage: "sign", approveUrl, orderId, amount: slip.budget },
        },
        resumeAt: "complete_signing",
      };
    },

    async complete_signing(ctx) {
      const slip = slipOf(ctx);
      const sig = PayPalReturnSignalSchema.safeParse(ctx.signal);
      if (!sig.success || !sig.data.approved) {
        rejectSlip(ctx, slip, "The buyer cancelled on PayPal.");
        return finish(ctx, "cancelled");
      }
      try {
        await ctx.core.completeSigning(slip.id);
      } catch (e) {
        return { fail: `PayPal could not place the hold: ${errorText(e)}` };
      }
      return { next: "shop" };
    },

    async shop(ctx) {
      const slip = slipOf(ctx);
      const s = ctx.run.state;
      const session = new ShopSession({
        ctx,
        slipId: slip.id,
        redTeam: s.redTeam,
        hireHelper: s.hireHelper,
        apiKey: apiKey(),
        fetch: opts.fetch,
        helperEmail: payee(),
      });
      const script = opts.agentScript
        ? opts.agentScript(s, slip)
        : mockAgentScript({ redTeam: s.redTeam, hireHelper: s.hireHelper, maxPrice: slip.budget.value });
      await ctx.ai.runAgent({
        label: "shop.agent",
        tier: "smart",
        system: AGENT_SYSTEM,
        task: agentTask(slip),
        tools: session.tools(),
        maxSteps: AGENT_MAX_STEPS,
        mock: script,
        onStep: (step) => {
          if (step.kind === "message") ctx.store.ledger.append(slip.id, "agent.step", "agent", { label: "shop.agent", step });
        },
      });
      const state: Partial<ShopState> = {
        proposals: session.proposals,
        helper: session.helper,
        catalogSource: session.source ?? s.catalogSource,
        ruledOut: session.ruledOut,
      };
      const first = session.options[0];
      if (!first) {
        await releaseHelper(ctx.core, ctx.store, session.helper);
        await ctx.core.releaseRemainder(slip.id);
        return finish(ctx, "no_cart", {
          ...state,
          helper: session.helper && session.helper.status === "accepted" ? { ...session.helper, status: "released" } : session.helper,
          note: "The agent found no cart within the slip. The hold was voided.",
        });
      }
      const next: ShopState = {
        ...s,
        ...state,
        options: session.options,
        chosenOptionId: first.id,
        cart: first.proposal,
        cartLines: first.lines,
        cartVerdict: first.verdict,
      } as ShopState;
      const wait = cartWait(next, slipOf(ctx), null);
      return { ...wait, state: { ...state, options: session.options, problem: null, ...("state" in wait ? wait.state : {}) } } as Result;
    },

    async confirm_cart(ctx) {
      const slip = slipOf(ctx);
      const s = ctx.run.state;
      const sig = ConfirmCartSignalSchema.safeParse(ctx.signal);
      if (!sig.success) return cartWait(s, slip, "Approve or decline the cart.");
      if (!sig.data.approved) {
        await releaseHelper(ctx.core, ctx.store, s.helper);
        await ctx.core.releaseRemainder(slip.id);
        return finish(ctx, "cancelled", {
          helper: s.helper && s.helper.status === "accepted" ? { ...s.helper, status: "released" } : s.helper,
          note: "You declined the cart. The hold was voided and nothing was charged.",
        });
      }
      const options = optionsOf(s);
      if (!options.length) return { fail: "There is no cart to approve." };
      // No optionId means the default option, which is always first in the list.
      const chosen = sig.data.optionId ? options.find((o) => o.id === sig.data.optionId) : options[0];
      if (!chosen) return cartWait(s, slip, "That option is not on the list.");
      const isSwitch = chosen.id !== (s.chosenOptionId ?? options[0].id);

      // The chosen option goes back through the guard before it becomes the cart.
      let cart = chosen.proposal;
      let verdict = ctx.core.evaluate(slip.id, cart);
      if (verdict.decision === "outside" && isSwitch) {
        const ids = [...new Set(verdict.violations.map((v) => v.clauseId))].join(", ");
        return cartWait(s, slip, `Option ${chosen.rank} is no longer within the slip (${ids}). Your earlier choice stands.`);
      }
      // The option already in place that now fails goes on to settle, which blocks it and voids the hold.
      const sel: ShopState = { ...s, options, cart, cartLines: chosen.lines, cartVerdict: verdict, chosenOptionId: chosen.id };
      if (verdict.decision === "ask") {
        const attestations = sig.data.attestations ?? [];
        const missing = verdict.unknowns.filter((u) => !attestations.some((a) => a.field === u.field)).map((u) => `${u.clauseId} ${u.field}`);
        if (missing.length) return cartWait(sel, slip, `Please confirm: ${[...new Set(missing)].join(", ")}.`);
        const applied = applyAttestations(cart, attestations);
        if (!applied.ok) return cartWait(sel, slip, applied.error);
        for (const a of attestations) {
          ctx.store.ledger.append(slip.id, "shop.attested", "user", { ...a, message: `You confirmed ${a.field} = ${String(a.value)}` });
        }
        cart = applied.cart;
        verdict = ctx.core.evaluate(slip.id, cart);
        if (verdict.decision !== "within") {
          const next = { ...sel, cart, cartVerdict: verdict };
          return cartWait(next, slip, verdict.decision === "outside" ? "With those facts the cart is outside the slip." : "The guard still needs your call.");
        }
      }
      const via = sig.data.via ?? "click";
      const titles = chosen.lines.map((l) => l.title);
      ctx.store.ledger.append(slip.id, "shop.option_chosen", "user", {
        optionId: chosen.id,
        rank: chosen.rank,
        titles,
        amount: cart.amount,
        via,
        message: `You chose option ${chosen.rank}: ${titles.join(" + ")}, ${formatMoney(cart.amount)}`,
      });
      return {
        next: "settle",
        state: { cart, cartLines: chosen.lines, cartVerdict: verdict, chosenOptionId: chosen.id, approvedVia: via, problem: null },
      };
    },

    async settle(ctx) {
      const slip = slipOf(ctx);
      const s = ctx.run.state;
      const cart = s.cart;
      if (!cart) return { fail: "There is no cart to settle." };
      let helper = s.helper;

      if (helper && helper.status === "accepted") {
        // The helper is paid before the capture, so check the cart first: no payout for a cart that won't settle.
        const pre = ctx.core.evaluate(slip.id, cart);
        if (pre.decision !== "within") {
          await releaseHelper(ctx.core, ctx.store, helper);
          await ctx.core.releaseRemainder(slip.id);
          return finish(ctx, "blocked", { cartVerdict: pre, helper: { ...helper, status: "released" }, note: "The guard blocked the cart at checkout." });
        }
        helper = await payHelper({ core: ctx.core, store: ctx.store, parentId: slip.id, record: helper });
      } else if (helper) {
        await releaseHelper(ctx.core, ctx.store, helper);
      }

      let captureId: string | null;
      try {
        const res = await ctx.core.settlePurchase(slip.id, cart, { finalCapture: true });
        if (res.verdict.decision !== "within" || !res.captureId) {
          await ctx.core.releaseRemainder(slip.id);
          return finish(ctx, "blocked", { cartVerdict: res.verdict, helper, note: "The guard blocked the cart at checkout. The hold was voided." });
        }
        captureId = res.captureId;
      } catch (e) {
        const error = errorText(e);
        ctx.store.ledger.append(slip.id, "shop.capture_failed", "rail", { error, message: error });
        try {
          await ctx.core.releaseRemainder(slip.id);
        } catch (voidError) {
          ctx.log(`Void after a failed capture also failed: ${errorText(voidError)}`);
        }
        return finish(ctx, "capture_failed", { helper, note: `PayPal capture failed: ${error}` });
      }
      await ctx.core.releaseRemainder(slip.id);
      const totals = totalsOf(slipOf(ctx));
      const affiliate = affiliateRecord(s, slip);
      for (const l of affiliate?.lines ?? []) {
        ctx.store.ledger.append(slip.id, ATTRIBUTED, "system", {
          listingId: l.listingId,
          network: l.network,
          accountId: l.accountId,
          url: l.url,
          lineTotal: l.lineTotal,
          estCommission: l.estCommission,
          captureId,
          message: `Affiliate link on ${l.listingId}${l.estCommission ? `, estimated commission ${formatMoney(l.estCommission)}` : ""}`,
        });
      }
      const wait = uploadWait(null);
      return { ...wait, state: { ...("state" in wait ? wait.state : {}), captureId, helper, totals, affiliate } } as Result;
    },

    async verify_delivery(ctx) {
      const slip = slipOf(ctx);
      const s = ctx.run.state;
      const sig = DeliverySignalSchema.safeParse(ctx.signal);
      if (!sig.success) return uploadWait("Upload a photo, use the sample photo, or skip.");
      if (sig.data.skip) return finish(ctx, "settled", { note: "Delivery check skipped." });
      let ref: string;
      let sample = false;
      if (sig.data.sample) {
        ref = ctx.store.blobs.put({ contentType: SAMPLE_PHOTO_CONTENT_TYPE, base64: SAMPLE_PHOTO_BASE64 });
        sample = true;
      } else {
        const given = sig.data.ref ?? sig.data.blobRef;
        if (!given) return uploadWait("Upload a photo or use the sample photo.");
        ref = given;
      }
      const blob = ctx.store.blobs.get(ref);
      const mediaType = blob?.contentType as ImageInput["mediaType"] | undefined;
      if (!blob || !mediaType || !IMAGE_TYPES.includes(mediaType)) return uploadWait("That file isn't a photo this check can read. Use PNG, JPEG, WebP or GIF.");

      const items = s.cart?.items ?? [];
      const raw = await ctx.ai.json({
        label: "shop.delivery_check",
        tier: "smart",
        system: DELIVERY_SYSTEM,
        prompt: deliveryPrompt(slip.clauses, items),
        schema: DeliveryCheckSchema,
        images: [{ mediaType, base64: blob.base64 }],
        mock: () => mockDeliveryCheck(sample, slip.clauses),
      });
      const check = cleanBreaches(raw, slip.clauses);
      const breached = check.breaches.length > 0;
      ctx.core.addEvidence(slip.id, {
        kind: "delivery_photo",
        verdict: breached ? "fail" : "pass",
        detail: deliveryEvidenceDetail(check),
        ref,
      });
      ctx.store.ledger.append(slip.id, "shop.delivery_checked", "agent", { photoRef: ref, sample, check, message: check.summary });
      const delivery = { photoRef: ref, sample, check };
      const decision = refundDecision(check);
      if (decision === "none") return finish(ctx, "settled", { delivery, note: "The delivery matches the slip." });
      if (decision === "refund") return { next: "refund", state: { delivery, problem: null } };
      const goods = s.cart ? formatMoney(s.cart.amount) : "the goods";
      return {
        wait: {
          kind: "user_confirm",
          message: `The photo may break ${check.breaches.map((b) => b.clauseId).join(", ")}, but the check isn't sure. Refund ${goods}?`,
          data: { stage: "refund", check, confirmLabel: `Refund ${goods}`, declineLabel: "Keep it" },
        },
        resumeAt: "confirm_refund",
        state: { delivery },
      };
    },

    async confirm_refund(ctx) {
      const sig = ConfirmRefundSignalSchema.safeParse(ctx.signal);
      if (sig.success && sig.data.approved) return { next: "refund" };
      return finish(ctx, "settled", { note: "You kept the delivery. No refund." });
    },

    async refund(ctx) {
      const slip = slipOf(ctx);
      const s = ctx.run.state;
      const captureId = s.captureId ?? slip.rail.captureIds[0] ?? null;
      if (!captureId || !s.cart) return { fail: "There is no capture to refund." };
      const breaches = s.delivery?.check.breaches ?? [];
      const reason = breaches.length
        ? `Breach of ${breaches.map((b) => b.clauseId).join(", ")}: ${breaches[0].observation}`.slice(0, 250)
        : "Delivery did not match the slip.";
      let refundId: string;
      try {
        ({ refundId } = await ctx.core.refund(slip.id, { captureId, amount: s.cart.amount, reason }));
      } catch (e) {
        const error = errorText(e);
        ctx.store.ledger.append(slip.id, "shop.refund_failed", "rail", { captureId, amount: s.cart.amount, error, message: error });
        return { fail: `PayPal refund failed: ${error}` };
      }
      let affiliate = s.affiliate;
      if (affiliate && !affiliate.reversed) {
        affiliate = { ...affiliate, reversed: true };
        ctx.store.ledger.append(slip.id, REVERSED, "system", {
          refundId,
          estCommission: affiliate.estCommission,
          lines: affiliate.lines.map((l) => l.listingId),
          message: `Refund reverses the estimated commission${affiliate.estCommission ? ` of ${formatMoney(affiliate.estCommission)}` : ""}`,
        });
      }
      const evidencePack = await ctx.core.evidencePack(slip.id);
      return finish(ctx, "refunded", { refundId, evidencePack, affiliate, note: `Refunded ${formatMoney(s.cart.amount)} for the goods.` });
    },
  };
}
