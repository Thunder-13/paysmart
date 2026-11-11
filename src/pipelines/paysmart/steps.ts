/**
 * PaySmart steps. Graph (see openspec/changes/add-paysmart-pipeline/design.md):
 *   intake -> understand -> handoff | [user_confirm clarify] clarify -> understand
 *   -> compile -> screen_request -> discover (one need per step) -> assemble -> board
 *   -> [user_confirm choose] choose -> sign -> [paypal_approval] complete_signing -> pay
 *   -> [user_upload delivery] aftercare -> refund | [user_confirm refund] confirm_refund -> done
 */
import type { ImageInput, MockAgentScript, Money, NewProposal, Slip, StepContext, StepResult } from "@/core/contracts";
import { estimateCommission } from "@/core/affiliate";
import { appendEvent, type SlipSigningStartedData } from "@/core/events";
import { formatMoney, fromCents, mulMoney, subMoney, toCents, zeroMoney } from "@/core/money";
import { catalogSource, readChannel3Key } from "@/pipelines/shop/catalog";
import { uncheckableAttributes, validateClauseEdits } from "@/pipelines/shop/compile";
import { cleanBreaches, DELIVERY_SYSTEM, deliveryEvidenceDetail, deliveryPrompt, mockDeliveryCheck, refundDecision } from "@/pipelines/shop/delivery";
import { SAMPLE_PHOTO_BASE64, SAMPLE_PHOTO_CONTENT_TYPE } from "@/pipelines/shop/sample-photo";
import { sortOptions } from "@/pipelines/shop/tools";
import { ATTESTABLE_FIELDS, DeliveryCheckSchema, type Attestation } from "@/pipelines/shop/types";
import { AGENT_MAX_STEPS, AGENT_SYSTEM, agentTask, demoIdsPresent, genericAssembleScript, mockAssembleScript } from "./agent";
import { restampProducts } from "./board";
import { mockCompile, PAYSMART_GUIDANCE, requestScreens } from "./compile";
import { discoverNeed } from "./discover";
import { finalizeRoute, mockRoute, ROUTER_SYSTEM, routerPrompt } from "./router";
import { AssembleSession, citedIds } from "./session";
import { funnelOf, topDropReasons } from "./screens";
import {
  ChooseSignalSchema,
  ClarifySignalSchema,
  ConfirmRefundSignalSchema,
  DeliverySignalSchema,
  MAX_CLARIFY,
  PayPalReturnSignalSchema,
  RouteDecisionSchema,
  type PaySmartOption,
  type PaySmartOutcome,
  type PaySmartState,
  type PaySmartTotals,
} from "./types";

export interface PaySmartOptions {
  /** Channel3 key lookup; defaults to process.env.CHANNEL3_API_KEY at call time. */
  channel3ApiKey?: () => string | null;
  fetch?: typeof fetch;
  /** Test hook: replace the scripted mock agent. */
  agentScript?: (state: PaySmartState, slip: Slip) => MockAgentScript;
}

type Ctx = StepContext<PaySmartState>;
type Result = StepResult<PaySmartState>;

const IMAGE_TYPES: ImageInput["mediaType"][] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function askText(s: PaySmartState): string {
  return [s.ask, ...s.clarifications].join("\n");
}

function slipOf(ctx: Ctx): Slip {
  const id = ctx.run.slipId;
  const slip = id ? ctx.store.slips.get(id) : null;
  if (!slip) throw new Error("This run has no slip yet.");
  return slip;
}

function limitOf(slip: Slip): Money {
  const c = slip.clauses.find((x) => x.kind === "budget_max");
  return c && c.kind === "budget_max" ? c.amount : slip.budget;
}

/** Held / captured / released / refunded from the slip itself. */
export function totalsOf(slip: Slip): PaySmartTotals {
  const currency = slip.budget.currency;
  const closed = ["settled", "released", "refunded"].includes(slip.status);
  let refunded = 0;
  const captures = slip.meta.captures;
  if (captures && typeof captures === "object") {
    for (const c of Object.values(captures as Record<string, { refunded?: Money }>)) if (c?.refunded) refunded += toCents(c.refunded);
  }
  return {
    limit: limitOf(slip),
    held: slip.rail.authorizationId ? slip.budget : zeroMoney(currency),
    captured: slip.spent,
    released: closed && slip.rail.authorizationId ? subMoney(slip.budget, slip.spent) : zeroMoney(currency),
    refunded: fromCents(refunded, currency),
  };
}

async function finish(ctx: Ctx, outcome: PaySmartOutcome, state: Partial<PaySmartState> = {}, withPack = false): Promise<Result> {
  const slipId = ctx.run.slipId;
  const slip = slipId ? ctx.store.slips.get(slipId) : null;
  const totals = slip ? totalsOf(slip) : null;
  const note = state.note ?? ctx.run.state.note ?? null;
  if (slip) ctx.store.ledger.append(slip.id, "paysmart.outcome", "system", { outcome, totals, note, message: note ?? outcome });
  let evidencePack = state.evidencePack ?? null;
  if (slip && withPack) evidencePack = await ctx.core.evidencePack(slip.id);
  return { done: true, state: { ...state, outcome, totals, evidencePack } };
}

function rejectSlip(ctx: Ctx, slip: Slip, reason: string): void {
  if (slip.status === "rejected") return;
  ctx.store.slips.update(slip.id, { status: "rejected" });
  appendEvent(ctx.store.ledger, slip.id, "slip.status", "user", { from: slip.status, to: "rejected", reason });
}

/* ------------------------------------------------------------- waits */

/** The question the last clarify wait asked. clarifyWait stores it in state.problem. */
function questionOf(s: PaySmartState): string {
  return s.problem ?? s.route?.clarify ?? "What should I look for?";
}

function clarifyWait(s: PaySmartState, question: string, problem: string | null, patch: Partial<PaySmartState> = {}): Result {
  return {
    wait: {
      kind: "user_confirm",
      message: problem ? `${problem} ${question}` : question,
      data: { stage: "clarify", question, round: s.clarifications.length + 1, maxRounds: MAX_CLARIFY, problem, summary: s.route?.summary ?? null, askVia: s.askVia },
    },
    resumeAt: "clarify",
    state: { ...patch, problem: question },
  };
}

async function askOrBlock(ctx: Ctx, question: string, patch: Partial<PaySmartState>): Promise<Result> {
  const s = ctx.run.state;
  if (s.clarifications.length >= MAX_CLARIFY) {
    const id = ctx.run.slipId;
    const slip = id ? ctx.store.slips.get(id) : null;
    if (slip) rejectSlip(ctx, slip, "PaySmart could not turn the ask into a slip.");
    return finish(ctx, "blocked", { ...patch, note: question });
  }
  return clarifyWait({ ...s, ...patch }, question, null, patch);
}

function chooseWait(s: PaySmartState, slip: Slip, problem: string | null): Result {
  const options = s.options;
  const selected = s.chosenOptionId && options.some((o) => o.id === s.chosenOptionId) ? s.chosenOptionId : (options[0]?.id ?? null);
  const zero = zeroMoney(slip.budget.currency);
  const rank = options.find((o) => o.id === selected)?.rank ?? 1;
  const base = options.length
    ? `Choose one of ${options.length} cart${options.length === 1 ? "" : "s"} the guard checked. PayPal holds exactly the cart total, and nothing is held until you approve on PayPal.`
    : "No cart fits your clauses. Edit them or decline.";
  return {
    wait: {
      kind: "user_confirm",
      message: problem ? `${problem} ${base}` : base,
      data: {
        stage: "choose",
        options: options.map((o) => ({ ...o, totals: { hold: o.proposal.amount, capture: o.proposal.amount, release: zero } })),
        ruledOut: s.ruledOut,
        selectedOptionId: selected,
        funnel: s.funnel,
        products: s.products,
        searches: s.searches,
        requestScreen: s.requestScreen,
        clauses: slip.clauses,
        limit: limitOf(slip),
        summary: slip.meta.summary ?? null,
        uncheckable: uncheckableAttributes(slip.clauses),
        problem,
        confirmLabel: options.length > 1 ? `Approve option ${rank}` : "Approve cart",
        declineLabel: "Decline",
      },
    },
    resumeAt: "choose",
    state: { problem, chosenOptionId: selected },
  };
}

function uploadWait(problem: string | null): Result {
  return {
    wait: {
      kind: "user_upload",
      message: problem ?? "When your order arrives, upload a photo of what came in the box (or use the sample photo).",
      data: { stage: "delivery", accept: IMAGE_TYPES.join(","), sampleAvailable: true, problem },
    },
    resumeAt: "aftercare",
    state: { problem },
  };
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

function chosenOf(s: PaySmartState): PaySmartOption | null {
  return s.options.find((o) => o.id === s.chosenOptionId) ?? null;
}

/* ---------------------------------------------------------------- steps */

export function initialPaySmartState(input: { ask: string; principal: PaySmartState["principal"]; redTeam: boolean; askVia: "typed" | "voice" }): PaySmartState {
  return {
    ask: input.ask,
    principal: input.principal,
    redTeam: input.redTeam,
    catalogSource: "fixtures",
    route: null,
    clarifications: [],
    requestScreen: [],
    compiled: null,
    askVia: input.askVia,
    searches: [],
    discoverCursor: 0,
    products: [],
    funnel: null,
    options: [],
    ruledOut: [],
    chosenOptionId: null,
    approvedVia: null,
    hold: null,
    captureId: null,
    totals: null,
    delivery: null,
    refundId: null,
    evidencePack: null,
    handoff: null,
    problem: null,
    outcome: null,
    note: null,
  };
}

export function createPaySmartSteps(opts: PaySmartOptions = {}): Record<string, (ctx: Ctx) => Promise<Result>> {
  const apiKey = () => (opts.channel3ApiKey ? opts.channel3ApiKey() : readChannel3Key());

  return {
    async intake() {
      return { next: "understand", state: { catalogSource: catalogSource(apiKey()) } };
    },

    async understand(ctx) {
      const s = ctx.run.state;
      const text = askText(s);
      const raw = await ctx.ai.json({
        label: "paysmart.route",
        tier: "fast",
        system: ROUTER_SYSTEM,
        prompt: routerPrompt(text),
        schema: RouteDecisionSchema,
        mock: () => mockRoute(text),
      });
      const { route, handoff } = finalizeRoute(raw, text);
      if (handoff) return { next: "handoff", state: { route, handoff } };
      if (route.clarify) return askOrBlock(ctx, route.clarify, { route });
      return { next: "compile", state: { route, problem: null } };
    },

    async clarify(ctx) {
      const s = ctx.run.state;
      const id = ctx.run.slipId;
      const old = id ? ctx.store.slips.get(id) : null;
      const sig = ClarifySignalSchema.safeParse(ctx.signal);
      if (!sig.success) return clarifyWait(s, questionOf(s), "Type an answer, or cancel.");
      if ("cancel" in sig.data) {
        if (old) rejectSlip(ctx, old, "You cancelled instead of answering.");
        return finish(ctx, "cancelled", { note: "You stopped before anything was searched or held." });
      }
      if (old) rejectSlip(ctx, old, "PaySmart asked a question and is starting a fresh slip from your answer.");
      return {
        next: "understand",
        state: {
          clarifications: [...s.clarifications, sig.data.answer],
          requestScreen: [],
          compiled: null,
          products: [],
          searches: [],
          discoverCursor: 0,
          funnel: null,
          problem: null,
        },
      };
    },

    async handoff(ctx) {
      const h = ctx.run.state.handoff;
      return finish(ctx, "handed_off", { note: h ? `${h.label}. ${h.why}` : "This ask belongs to another pipeline." });
    },

    async compile(ctx) {
      const s = ctx.run.state;
      const text = askText(s);
      const needs = s.route?.needs ?? [];
      const compiled = await ctx.core.compileSlip({
        pipeline: "paysmart",
        intent: text,
        principal: s.principal,
        guidance: PAYSMART_GUIDANCE,
        mock: () => mockCompile(text, needs, ctx.now()),
      });
      const slip = ctx.core.createSlip({
        pipeline: "paysmart",
        principal: s.principal,
        intent: text,
        clauses: compiled.clauses,
        budget: compiled.budget,
        expiresAt: compiled.expiresAt,
        meta: { summary: compiled.summary, redTeam: s.redTeam, askVia: s.askVia, needs },
      });
      ctx.store.ledger.append(slip.id, "slip.compiled", "system", { summary: compiled.summary, clauses: compiled.clauses.length, message: compiled.summary });
      ctx.store.ledger.append(slip.id, "paysmart.routed", "system", {
        useCase: s.route?.useCase ?? "buy",
        needs,
        askVia: s.askVia,
        ask: s.ask,
        message: `Understood as ${s.route?.useCase ?? "buy"} from a ${s.askVia === "voice" ? "spoken" : "typed"} ask: ${s.route?.summary ?? ""}`.trim(),
      });
      return { next: "screen_request", slipId: slip.id, state: { compiled } };
    },

    async screen_request(ctx) {
      const slip = slipOf(ctx);
      const s = ctx.run.state;
      const { results, question } = requestScreens({ clauses: slip.clauses, budget: slip.budget, ask: askText(s), now: ctx.now() });
      ctx.store.ledger.append(slip.id, "paysmart.request_screened", "system", {
        results,
        question,
        message: question ? `Your ask needs an answer before PaySmart searches: ${question}` : "Your ask passed the request screen",
      });
      if (question) return askOrBlock(ctx, question, { requestScreen: results });
      return { next: "discover", state: { requestScreen: results, searches: [], products: [], discoverCursor: 0, problem: null } };
    },

    async discover(ctx) {
      const slip = slipOf(ctx);
      const s = ctx.run.state;
      const needs = s.route?.needs ?? [];
      if (s.discoverCursor >= needs.length) return { next: "assemble" };
      const patch = await discoverNeed(ctx, { apiKey: apiKey(), fetch: opts.fetch }, slip, s.discoverCursor);
      return { next: (patch.discoverCursor ?? 0) >= needs.length ? "assemble" : "discover", state: patch };
    },

    async assemble(ctx) {
      const slip = slipOf(ctx);
      const s = ctx.run.state;
      const needs = s.route?.needs ?? [];
      const session = new AssembleSession({ ctx, slip, products: s.products, needs });
      const script = opts.agentScript
        ? opts.agentScript(s, slip)
        : demoIdsPresent(s.products)
          ? mockAssembleScript({ needs, redTeam: s.redTeam })
          : genericAssembleScript({ needs, searches: s.searches, products: s.products });
      await ctx.ai.runAgent({
        label: "paysmart.agent",
        tier: "smart",
        system: AGENT_SYSTEM,
        task: agentTask(slip, needs, s.products, s.searches),
        tools: session.tools(),
        maxSteps: AGENT_MAX_STEPS,
        mock: script,
        onStep: (step) => {
          if (step.kind === "message") {
            ctx.store.ledger.append(slip.id, "agent.step", "agent", { label: "paysmart.agent", step, message: step.text });
          }
        },
      });
      return { next: "board", state: { products: session.products, options: session.options, ruledOut: session.ruledOut } };
    },

    async board(ctx) {
      const slip = slipOf(ctx);
      const s = ctx.run.state;
      const products = restampProducts(ctx, slip, s.products, s.route?.needs ?? []);
      const funnel = funnelOf(products, s.options);
      ctx.store.ledger.append(slip.id, "paysmart.board", "system", {
        funnel,
        options: s.options.length,
        ruledOutCarts: s.ruledOut.length,
        message: `${funnel.found} listings found, ${funnel.clean} clean, ${funnel.trusted} trusted sellers, ${funnel.withinSlip} within your slip, ${funnel.inCarts} in carts`,
      });
      if (!s.options.length) {
        rejectSlip(ctx, slip, "No cart fit the slip.");
        const reasons = topDropReasons(products);
        return finish(ctx, "no_options", {
          products,
          funnel,
          note: `No cart fit your slip. Most products were dropped for: ${reasons.length ? reasons.join("; ") : "no listing passed every screen"}.`,
        });
      }
      const next: PaySmartState = { ...s, products, funnel, chosenOptionId: s.options[0]?.id ?? null };
      const wait = chooseWait(next, slip, null);
      return { ...wait, state: { products, funnel, ...("state" in wait ? wait.state : {}) } } as Result;
    },

    async choose(ctx) {
      let slip = slipOf(ctx);
      const s = ctx.run.state;
      const sig = ChooseSignalSchema.safeParse(ctx.signal);
      if (!sig.success) return chooseWait(s, slip, "Pick an option or decline.");
      if (!sig.data.approved) {
        rejectSlip(ctx, slip, "You declined every cart.");
        return finish(ctx, "cancelled", { note: "You declined. Nothing was held or charged." });
      }

      if (sig.data.clauses) {
        const v = validateClauseEdits(slip.clauses, sig.data.clauses);
        if (!v.ok) return chooseWait(s, slip, v.error);
        if (v.changed) {
          slip = ctx.store.slips.update(slip.id, { clauses: v.clauses, budget: v.budget, ...(v.expiresAt ? { expiresAt: v.expiresAt } : {}) });
          const products = restampProducts(ctx, slip, s.products, s.route?.needs ?? []);
          const kept: PaySmartOption[] = [];
          const ruledOut = [...s.ruledOut];
          for (const o of s.options) {
            const verdict = ctx.core.evaluate(slip.id, o.proposal);
            if (verdict.decision === "outside") {
              ruledOut.push({ title: o.lines.map((l) => l.title).join(" + "), amount: o.proposal.amount, clauseIds: citedIds(verdict) });
            } else kept.push({ ...o, verdict });
          }
          const options = sortOptions(kept);
          const funnel = funnelOf(products, options);
          ctx.store.ledger.append(slip.id, "paysmart.clauses_edited", "user", {
            before: s.compiled?.clauses ?? null,
            after: v.clauses,
            budget: v.budget,
            optionsBefore: s.options.length,
            optionsAfter: options.length,
            message: `You edited the clauses; ${options.length} of ${s.options.length} carts still fit. Limit ${formatMoney(v.budget)}`,
          });
          const next: PaySmartState = { ...s, products, options, ruledOut, funnel, chosenOptionId: options[0]?.id ?? null };
          const wait = chooseWait(next, slip, `Clauses updated, every product and cart was checked again. ${options.length} cart${options.length === 1 ? "" : "s"} still fit.`);
          return { ...wait, state: { products, options, ruledOut, funnel, ...("state" in wait ? wait.state : {}) } } as Result;
        }
      }

      const options = s.options;
      const chosen = sig.data.optionId ? options.find((o) => o.id === sig.data.optionId) : options[0];
      if (!chosen) return chooseWait(s, slip, options.length ? "That option is not on the list." : "There is no cart to approve.");

      let cart = chosen.proposal;
      let verdict = ctx.core.evaluate(slip.id, cart);
      if (verdict.decision === "outside") {
        const ids = citedIds(verdict).join(", ");
        return chooseWait({ ...s, chosenOptionId: s.chosenOptionId ?? options[0]?.id ?? null }, slip, `Option ${chosen.rank} is no longer within the slip (${ids}).`);
      }
      if (verdict.decision === "ask") {
        const attestations = sig.data.attestations ?? [];
        const missing = verdict.unknowns.filter((u) => !attestations.some((a) => a.field === u.field)).map((u) => `${u.clauseId} ${u.field}`);
        const sel = { ...s, chosenOptionId: chosen.id };
        if (missing.length) return chooseWait(sel, slip, `Please confirm: ${[...new Set(missing)].join(", ")}.`);
        const applied = applyAttestations(cart, attestations);
        if (!applied.ok) return chooseWait(sel, slip, applied.error);
        for (const a of attestations) {
          ctx.store.ledger.append(slip.id, "paysmart.attested", "user", { ...a, message: `You confirmed ${a.field} = ${String(a.value)}` });
        }
        cart = applied.cart;
        verdict = ctx.core.evaluate(slip.id, cart);
        if (verdict.decision !== "within") {
          return chooseWait(sel, slip, verdict.decision === "outside" ? "With those facts the cart is outside the slip." : "The guard still needs your call.");
        }
      }
      const via = sig.data.via ?? "click";
      const titles = chosen.lines.map((l) => l.title);
      ctx.store.ledger.append(slip.id, "paysmart.option_chosen", "user", {
        optionId: chosen.id,
        rank: chosen.rank,
        titles,
        amount: cart.amount,
        via,
        message: `You chose option ${chosen.rank}: ${titles.join(" + ")}, ${formatMoney(cart.amount)}`,
      });
      return {
        next: "sign",
        state: { options: options.map((o) => (o.id === chosen.id ? { ...o, proposal: cart, verdict } : o)), chosenOptionId: chosen.id, approvedVia: via, problem: null },
      };
    },

    async sign(ctx) {
      const slip = slipOf(ctx);
      const s = ctx.run.state;
      const chosen = chosenOf(s);
      if (!chosen) return { fail: "There is no chosen cart to sign for." };
      const held = chosen.proposal.amount;
      const limit = limitOf(slip);
      ctx.store.slips.update(slip.id, { budget: held });
      ctx.store.ledger.append(slip.id, "paysmart.hold_sized", "system", {
        limit,
        held,
        message: `PayPal will hold ${formatMoney(held)}, the cart total, not the ${formatMoney(limit)} limit`,
      });
      let approveUrl: string;
      let orderId: string;
      try {
        ({ approveUrl, orderId } = await ctx.core.beginSigning(slip.id, { intent: "AUTHORIZE", returnPath: "/p/paysmart" }));
      } catch (e) {
        return { fail: `PayPal could not start the hold: ${errorText(e)}` };
      }
      return {
        wait: {
          kind: "paypal_approval",
          message: `Approve on PayPal to hold ${formatMoney(held)}. It is captured only for the cart you chose.`,
          data: { stage: "sign", approveUrl, orderId, amount: held },
        },
        resumeAt: "complete_signing",
        state: { hold: held },
      };
    },

    async complete_signing(ctx) {
      const slip = slipOf(ctx);
      const sig = PayPalReturnSignalSchema.safeParse(ctx.signal);
      if (!sig.success) {
        const started = [...ctx.store.ledger.list(slip.id)].reverse().find((e) => e.type === "slip.signing_started");
        const d = started?.data as SlipSigningStartedData | undefined;
        if (!d) return { fail: "The PayPal approval could not be found again." };
        return {
          wait: {
            kind: "paypal_approval",
            message: "Approve on PayPal, or cancel there.",
            data: { stage: "sign", approveUrl: d.approveUrl, orderId: d.orderId, amount: slip.budget },
          },
          resumeAt: "complete_signing",
        };
      }
      if (!sig.data.approved) {
        rejectSlip(ctx, slip, "The buyer cancelled on PayPal.");
        return finish(ctx, "cancelled", { note: "You cancelled on PayPal. Nothing was captured." });
      }
      try {
        await ctx.core.completeSigning(slip.id);
      } catch (e) {
        return { fail: `PayPal could not place the hold: ${errorText(e)}` };
      }
      return { next: "pay" };
    },

    async pay(ctx) {
      const slip = slipOf(ctx);
      const s = ctx.run.state;
      const chosen = chosenOf(s);
      if (!chosen) return { fail: "There is no chosen cart to pay for." };
      const cart = chosen.proposal;
      let captureId: string | null;
      try {
        const res = await ctx.core.settlePurchase(slip.id, cart, { finalCapture: true });
        if (res.verdict.decision !== "within" || !res.captureId) {
          await ctx.core.releaseRemainder(slip.id);
          const ids = citedIds(res.verdict).join(", ");
          return finish(ctx, "blocked", { note: `The guard blocked the cart at checkout${ids ? ` (${ids})` : ""}. The hold was voided.` });
        }
        captureId = res.captureId;
      } catch (e) {
        const error = errorText(e);
        ctx.store.ledger.append(slip.id, "paysmart.capture_failed", "rail", { error, message: error });
        try {
          await ctx.core.releaseRemainder(slip.id);
        } catch (voidError) {
          ctx.log(`Void after a failed capture also failed: ${errorText(voidError)}`);
        }
        return finish(ctx, "capture_failed", { note: `PayPal capture failed: ${error}` });
      }
      await ctx.core.releaseRemainder(slip.id);
      const totals = totalsOf(slipOf(ctx));
      for (const l of chosen.lines) {
        if (!l.affiliate) continue;
        const lineTotal = mulMoney(l.unitPrice, l.quantity);
        const est = estimateCommission(lineTotal, l.affiliate.commissionBps);
        ctx.store.ledger.append(slip.id, "affiliate.attributed", "system", {
          listingId: l.listingId,
          network: l.affiliate.network,
          accountId: l.affiliate.accountId,
          url: l.affiliate.url,
          lineTotal,
          estCommission: est,
          captureId,
          message: `Affiliate link on ${l.listingId}${est ? `, estimated commission ${formatMoney(est)}` : ""}`,
        });
      }
      ctx.store.ledger.append(slip.id, "paysmart.paid", "system", {
        captureId,
        totals,
        message: `Paid ${formatMoney(totals.captured)} for ${chosen.lines.map((l) => l.title).join(" + ")}. ${formatMoney(totals.released)} released. Dispute-ready: this payment's evidence is chained.`,
      });
      const wait = uploadWait(null);
      return { ...wait, state: { ...("state" in wait ? wait.state : {}), captureId, totals } } as Result;
    },

    async aftercare(ctx) {
      const slip = slipOf(ctx);
      const s = ctx.run.state;
      const sig = DeliverySignalSchema.safeParse(ctx.signal);
      if (!sig.success) return uploadWait("Upload a photo, use the sample photo, or skip.");
      if (sig.data.skip) return finish(ctx, "paid", { note: "Delivery check skipped." }, true);
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

      const items = chosenOf(s)?.proposal.items ?? [];
      const raw = await ctx.ai.json({
        label: "paysmart.delivery_check",
        tier: "smart",
        system: DELIVERY_SYSTEM,
        prompt: deliveryPrompt(slip.clauses, items),
        schema: DeliveryCheckSchema,
        images: [{ mediaType, base64: blob.base64 }],
        mock: () => mockDeliveryCheck(sample, slip.clauses),
      });
      const check = cleanBreaches(raw, slip.clauses);
      const breached = check.breaches.length > 0;
      ctx.core.addEvidence(slip.id, { kind: "delivery_photo", verdict: breached ? "fail" : "pass", detail: deliveryEvidenceDetail(check), ref });
      ctx.store.ledger.append(slip.id, "paysmart.delivery_checked", "agent", { photoRef: ref, sample, check, message: check.summary });
      const delivery = { photoRef: ref, sample, check };
      const decision = refundDecision(check);
      if (decision === "none") return finish(ctx, "paid", { delivery, note: "The delivery matches the slip." }, true);
      if (decision === "refund") return { next: "refund", state: { delivery, problem: null } };
      const total = chosenOf(s) ? formatMoney(chosenOf(s)!.proposal.amount) : "the order";
      return {
        wait: {
          kind: "user_confirm",
          message: `The photo may break ${check.breaches.map((b) => b.clauseId).join(", ")}, but the check isn't sure. Refund ${total}?`,
          data: { stage: "refund", check, confirmLabel: `Refund ${total}`, declineLabel: "Keep it" },
        },
        resumeAt: "confirm_refund",
        state: { delivery },
      };
    },

    async confirm_refund(ctx) {
      const sig = ConfirmRefundSignalSchema.safeParse(ctx.signal);
      if (sig.success && sig.data.approved) return { next: "refund" };
      return finish(ctx, "paid", { note: "You kept the delivery. No refund." }, true);
    },

    async refund(ctx) {
      const slip = slipOf(ctx);
      const s = ctx.run.state;
      const chosen = chosenOf(s);
      const captureId = s.captureId ?? slip.rail.captureIds[0] ?? null;
      if (!captureId || !chosen) return { fail: "There is no capture to refund." };
      const breaches = s.delivery?.check.breaches ?? [];
      const reason = breaches.length
        ? `Breach of ${breaches.map((b) => b.clauseId).join(", ")}: ${breaches[0].observation}`.slice(0, 250)
        : "Delivery did not match the slip.";
      let refundId: string;
      try {
        ({ refundId } = await ctx.core.refund(slip.id, { captureId, amount: chosen.proposal.amount, reason }));
      } catch (e) {
        const error = errorText(e);
        ctx.store.ledger.append(slip.id, "paysmart.refund_failed", "rail", { captureId, error, message: error });
        return { fail: `PayPal refund failed: ${error}` };
      }
      return finish(ctx, "refunded", { refundId, note: `Refunded ${formatMoney(chosen.proposal.amount)}.` }, true);
    },
  };
}

