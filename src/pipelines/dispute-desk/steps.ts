/**
 * Steps: load -> link -> pack -> triage -> draft -> WAIT user_confirm (resumeAt "act") -> act -> done.
 * Every PayPal write waits on the merchant. Bad signals and PayPal errors return to the same wait.
 */
import type { EvidencePack, StepContext, StepResult, Store } from "@/core/contracts";
import { buildEvidenceDocuments, fromBase64, toBase64 } from "./documents";
import {
  brokenChainLine,
  chooseEvidenceType,
  composeNotes,
  DRAFT_LABEL,
  DRAFT_SYSTEM,
  draftPrompt,
  ensureFooters,
  hashFooter,
  mockDraft,
} from "./draft";
import { deriveFacts } from "./facts";
import { linkDispute } from "./link";
import { readBuyerClaim } from "./quarantine";
import { applyHonestyFloor, modelFromRules, recommendByRules, toRecommendation } from "./rules";
import { TRIAGE_LABEL, TRIAGE_SYSTEM, triagePrompt } from "./triage";
import {
  ModelRecommendationSchema,
  NOTES_MAX,
  ResumeSignalSchema,
  STATUS_RESOLVED,
  STATUS_WAITING_FOR_SELLER,
  type ActDecision,
  type ConfirmWaitData,
  type DisputeCase,
  type DisputeDeskState,
  type DraftDocument,
  type DraftState,
  type Outcome,
  type PackDigest,
  type Recommendation,
} from "./types";

type Ctx = StepContext<DisputeDeskState>;
type Result = StepResult<DisputeDeskState>;

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function casesOf(store: Store) {
  return store.collection<DisputeCase>("dispute-desk", "cases");
}

function putCase(ctx: Ctx, patch: Partial<DisputeCase>): void {
  const { disputeId } = ctx.run.state;
  const col = casesOf(ctx.store);
  const prev = col.get(disputeId);
  const base: DisputeCase =
    prev && prev.runId === ctx.run.id
      ? prev
      : { disputeId, runId: ctx.run.id, slipId: null, linkMethod: "none", decision: null, confidence: null, outcome: null, paypalStatus: null, updatedAt: "" };
  col.put(disputeId, { ...base, ...patch, disputeId, runId: ctx.run.id, updatedAt: ctx.now().toISOString() });
}

export function loadPinnedPack(store: Store, ref: string): EvidencePack {
  const blob = store.blobs.get(ref);
  if (!blob) throw new Error(`Pinned evidence pack ${ref} is missing.`);
  return JSON.parse(fromBase64(blob.base64)) as EvidencePack;
}

export function suggestedDecision(rec: Recommendation | null): ActDecision {
  if (!rec || rec.decision === "need_more") return "hold";
  return rec.decision;
}

function footersFor(pack: PackDigest | null, documents: DraftDocument[]): string[] {
  const footers: string[] = [];
  if (pack && !pack.chainOk) footers.push(brokenChainLine(pack.brokenAtSeq));
  const json = documents.find((d) => d.contentType === "application/json");
  if (json) footers.push(hashFooter(json.sha256));
  return footers;
}

function confirmWait(state: DisputeDeskState, draft: DraftState, error: string | null, extra: Partial<DisputeDeskState> = {}): Result {
  const rec = state.recommendation!;
  const suggested = suggestedDecision(rec);
  const data: ConfirmWaitData = {
    confirmLabel: suggested === "accept" ? "Accept claim on PayPal" : suggested === "contest" ? "Send evidence to PayPal" : "Hold for now",
    declineLabel: "Hold",
    disputeId: state.disputeId,
    suggestedDecision: suggested,
    recommendation: rec,
    notes: draft.notes,
    notesMax: NOTES_MAX,
    documents: draft.documents.map(({ name, contentType, bytes, sha256 }) => ({ name, contentType, bytes, sha256 })),
    evidenceType: draft.evidenceType,
    error,
  };
  const message = error
    ? `Nothing was sent. ${error}`
    : `Review the response (recommended: ${rec.decision.replace("_", " ")}). Nothing goes to PayPal until you confirm.`;
  return { wait: { kind: "user_confirm", message, data }, resumeAt: "act", state: { ...extra, draft, confirmError: error } };
}

function finish(ctx: Ctx, outcome: Outcome): Result {
  putCase(ctx, { outcome: outcome.kind, paypalStatus: outcome.paypalStatus });
  return { done: true, state: { outcome, confirmError: null } };
}

/** {decision, notes}, or the generic WaitPanel's {approved} (true = suggested decision with the draft). */
export function parseSignal(signal: unknown, state: DisputeDeskState): { ok: true; decision: ActDecision; notes: string } | { ok: false; error: string } {
  if (signal && typeof signal === "object" && !("decision" in signal) && typeof (signal as { approved?: unknown }).approved === "boolean") {
    if (!(signal as { approved: boolean }).approved) return { ok: true, decision: "hold", notes: "" };
    return { ok: true, decision: suggestedDecision(state.recommendation), notes: state.draft?.notes ?? "" };
  }
  const parsed = ResumeSignalSchema.safeParse(signal);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join(" ") };
  return { ok: true, decision: parsed.data.decision, notes: parsed.data.notes };
}

/* ---------------------------------------------------------------- steps */

async function load(ctx: Ctx): Promise<Result> {
  const { disputeId } = ctx.run.state;
  try {
    const dispute = await ctx.rail.getDispute(disputeId);
    return { next: "link", state: { dispute } };
  } catch (e) {
    return { fail: `PayPal couldn't load dispute ${disputeId}: ${msg(e)}` };
  }
}

async function link(ctx: Ctx): Promise<Result> {
  const state = ctx.run.state;
  const dispute = state.dispute!;
  const { link: found, handoff, warnings } = linkDispute(ctx.store, dispute.transactionId);
  putCase(ctx, { slipId: found.slipId, linkMethod: found.method });
  return {
    next: "pack",
    state: { link: found, handoff, warnings: [...state.warnings, ...warnings] },
    ...(found.slipId ? { slipId: found.slipId } : {}),
  };
}

async function pack(ctx: Ctx): Promise<Result> {
  const slipId = ctx.run.state.link?.slipId ?? null;
  if (!slipId) return { next: "triage", state: { pack: null } };
  const p = await ctx.core.evidencePack(slipId);
  const ref = ctx.store.blobs.put({ contentType: "application/json", base64: toBase64(JSON.stringify(p)) });
  const digest: PackDigest = {
    ref,
    chainOk: p.chain.ok,
    brokenAtSeq: p.chain.brokenAtSeq,
    eventCount: p.events.length,
    headHash: p.events.at(-1)?.hash ?? null,
    summary: p.summary,
    generatedAt: p.generatedAt,
  };
  return { next: "triage", state: { pack: digest } };
}

async function triage(ctx: Ctx): Promise<Result> {
  const state = ctx.run.state;
  const dispute = state.dispute!;
  const p = state.pack ? loadPinnedPack(ctx.store, state.pack.ref) : null;
  const { claim, warnings: claimWarnings } = await readBuyerClaim(ctx.ai, dispute);
  const warnings = [...state.warnings, ...claimWarnings];
  const facts = deriveFacts({ dispute, claim, pack: p });
  const rules = recommendByRules(facts);

  let recommendation: Recommendation;
  if (rules.rule === 1 || rules.rule === 2 || !p) {
    recommendation = toRecommendation(rules);
  } else {
    try {
      const model = await ctx.ai.json({
        label: TRIAGE_LABEL,
        tier: "smart",
        system: TRIAGE_SYSTEM,
        prompt: triagePrompt({ dispute, claim, pack: p, facts }),
        schema: ModelRecommendationSchema,
        mock: () => modelFromRules(rules),
      });
      recommendation = applyHonestyFloor(model, rules, facts);
    } catch (e) {
      recommendation = toRecommendation(rules);
      warnings.push(`The AI triage failed (${msg(e)}), so this is the rules-based recommendation.`);
    }
  }

  const slipId = state.link?.slipId ?? null;
  if (slipId) {
    ctx.store.ledger.append(slipId, "dispute-desk.recommended", "agent", {
      disputeId: dispute.id,
      runId: ctx.run.id,
      decision: recommendation.decision,
      confidence: recommendation.confidence,
      citedSeqs: recommendation.citedSeqs,
      citedClauseIds: recommendation.citedClauseIds,
      overriddenFrom: recommendation.override?.from ?? null,
      alreadyRefunded: recommendation.alreadyRefunded,
    });
  }
  putCase(ctx, { decision: recommendation.decision, confidence: recommendation.confidence });
  return { next: "draft", state: { claim, recommendation, warnings } };
}

async function draft(ctx: Ctx): Promise<Result> {
  const state = ctx.run.state;
  const dispute = state.dispute!;
  const rec = state.recommendation!;
  const p = state.pack ? loadPinnedPack(ctx.store, state.pack.ref) : null;
  const warnings = [...state.warnings];

  const docs = p ? buildEvidenceDocuments({ pack: p, dispute, recommendation: rec, handoff: state.handoff, generatedAt: ctx.now().toISOString() }) : [];
  const documents: DraftDocument[] = docs.map((d) => ({
    name: d.name,
    contentType: d.contentType,
    bytes: d.bytes,
    sha256: d.sha256,
    ref: ctx.store.blobs.put({ contentType: d.contentType, base64: d.base64 }),
  }));

  const events = p?.events ?? [];
  const clauses = p?.slip.clauses ?? [];
  const outline = mockDraft({ dispute, recommendation: rec, events, clauses });
  let body = outline;
  try {
    body = await ctx.ai.text({
      label: DRAFT_LABEL,
      tier: "smart",
      system: DRAFT_SYSTEM,
      prompt: draftPrompt({ dispute, recommendation: rec, events, clauses, outline }),
      mock: () => outline,
    });
  } catch (e) {
    warnings.push(`The AI draft failed (${msg(e)}), so the notes use the plain template.`);
  }
  if (!body.trim()) body = outline;

  const draftState: DraftState = {
    notes: composeNotes(body, footersFor(state.pack, documents)),
    documents,
    evidenceType: chooseEvidenceType(rec),
  };
  return confirmWait(state, draftState, null, { warnings });
}

async function act(ctx: Ctx): Promise<Result> {
  const state = ctx.run.state;
  const draftState = state.draft!;
  const parsed = parseSignal(ctx.signal, state);
  if (!parsed.ok) return confirmWait(state, draftState, parsed.error);
  const { decision, notes } = parsed;
  // Keep the merchant's edit if we have to come back to the wait.
  const edited: DraftState = decision === "hold" ? draftState : { ...draftState, notes };

  if (decision === "hold") {
    return finish(ctx, { kind: "held", decision, paypalStatus: null, ledgerSeq: null, message: "Held. Nothing was sent to PayPal." });
  }

  let status: string;
  try {
    status = (await ctx.rail.getDispute(state.disputeId)).status;
  } catch (e) {
    return confirmWait(state, edited, `Couldn't re-check the dispute with PayPal: ${msg(e)}`);
  }
  if (decision === "contest" && status !== STATUS_WAITING_FOR_SELLER) {
    return finish(ctx, {
      kind: "not_actionable",
      decision,
      paypalStatus: status,
      ledgerSeq: null,
      message: `PayPal shows this dispute as ${status}. Evidence can only be sent while it waits on the seller, so nothing was sent.`,
    });
  }
  if (decision === "accept" && status === STATUS_RESOLVED) {
    return finish(ctx, { kind: "not_actionable", decision, paypalStatus: status, ledgerSeq: null, message: "PayPal already resolved this dispute, so nothing was sent." });
  }

  const slipId = state.link?.slipId ?? null;
  const rec = state.recommendation!;

  if (decision === "contest") {
    const citable = slipId !== null && state.pack?.chainOk === true;
    const sent = citable ? draftState.documents : [];
    const documents = sent.flatMap((d) => {
      const blob = ctx.store.blobs.get(d.ref);
      return blob ? [{ name: d.name, contentType: d.contentType, base64: blob.base64 }] : [];
    });
    const finalNotes = state.pack && !state.pack.chainOk ? ensureFooters(notes, [brokenChainLine(state.pack.brokenAtSeq)]) : notes;
    let paypalStatus: string;
    try {
      const res = await ctx.rail.provideEvidence(state.disputeId, {
        notes: finalNotes,
        ...(documents.length ? { documents } : {}),
        evidenceType: draftState.evidenceType,
      });
      paypalStatus = res.status;
    } catch (e) {
      return confirmWait(state, edited, `PayPal didn't accept the evidence: ${msg(e)}`);
    }
    const ev = slipId
      ? ctx.store.ledger.append(slipId, "rail.dispute_evidence", "rail", {
          disputeId: state.disputeId,
          status: paypalStatus,
          documents: documents.map((d) => d.name),
          documentHashes: sent.filter((d) => documents.some((x) => x.name === d.name)).map((d) => ({ name: d.name, sha256: d.sha256 })),
          evidenceType: draftState.evidenceType,
          citedSeqs: citable ? rec.citedSeqs : [],
          runId: ctx.run.id,
        })
      : null;
    return finish(ctx, {
      kind: "evidence_sent",
      decision,
      paypalStatus,
      ledgerSeq: ev?.seq ?? null,
      message: `Evidence sent to PayPal (status ${paypalStatus}).`,
    });
  }

  let paypalStatus: string;
  try {
    paypalStatus = (await ctx.rail.acceptClaim(state.disputeId, notes)).status;
  } catch (e) {
    return confirmWait(state, edited, `PayPal didn't accept the claim acceptance: ${msg(e)}`);
  }
  const ev = slipId
    ? ctx.store.ledger.append(slipId, "rail.dispute_accepted", "rail", {
        disputeId: state.disputeId,
        status: paypalStatus,
        note: notes,
        alreadyRefunded: rec.alreadyRefunded,
        runId: ctx.run.id,
      })
    : null;
  return finish(ctx, {
    kind: "claim_accepted",
    decision,
    paypalStatus,
    ledgerSeq: ev?.seq ?? null,
    message: `Claim accepted on PayPal (status ${paypalStatus}).`,
  });
}

export const STEPS = { load, link, pack, triage, draft, act };
