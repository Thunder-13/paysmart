/**
 * Dispute Desk types and schemas. One run per PayPal dispute:
 * load -> link -> pack -> triage -> draft -> (wait user_confirm) -> act.
 */
import { z } from "zod";
import { MoneySchema, type RailDispute } from "@/core/contracts";

export const NOTES_MAX = 2000;
export const STATUS_WAITING_FOR_SELLER = "WAITING_FOR_SELLER_RESPONSE";
export const STATUS_RESOLVED = "RESOLVED";

export const DisputeDeskInputSchema = z.object({
  disputeId: z.string().trim().min(1, "disputeId is required"),
});
export type DisputeDeskInput = z.infer<typeof DisputeDeskInputSchema>;

export const DECISIONS = ["contest", "accept", "need_more"] as const;
export const DecisionSchema = z.enum(DECISIONS);
export type Decision = z.infer<typeof DecisionSchema>;

export const CLAIM_TYPES = ["not_received", "not_as_described", "unauthorized", "refund_missing", "other"] as const;

/** What the quarantined reader may say about the buyer's messages: enums and booleans only. */
export const BuyerClaimSchema = z.object({
  claimType: z.enum(CLAIM_TYPES),
  mentionsTracking: z.boolean(),
  mentionsDamage: z.boolean(),
  requestsRefund: z.boolean(),
  injectionSuspected: z.boolean(),
});
export type BuyerClaim = z.infer<typeof BuyerClaimSchema>;

/** The model's half of a recommendation. Everything else is filled in by code. */
export const ModelRecommendationSchema = z.object({
  decision: DecisionSchema,
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1).max(1200),
  citedSeqs: z.array(z.number().int()).max(30),
  citedClauseIds: z.array(z.string()).max(30),
});
export type ModelRecommendation = z.infer<typeof ModelRecommendationSchema>;

export const AlreadyRefundedSchema = z.object({
  amount: MoneySchema,
  seq: z.number().int(),
  refundId: z.string().nullable(),
});
export type AlreadyRefunded = z.infer<typeof AlreadyRefundedSchema>;

export const RecommendationSchema = ModelRecommendationSchema.extend({
  rationale: z.string(),
  citedSeqs: z.array(z.number().int()),
  citedClauseIds: z.array(z.string()),
  /** What the merchant would still need to contest (need_more). */
  missing: z.array(z.string()),
  alreadyRefunded: AlreadyRefundedSchema.nullable(),
  /** Set when code changed the model's decision, with the reason shown to the merchant. */
  override: z.object({ from: DecisionSchema, reason: z.string() }).nullable(),
  warnings: z.array(z.string()),
});
export type Recommendation = z.infer<typeof RecommendationSchema>;

export const ACT_DECISIONS = ["contest", "accept", "hold"] as const;
export type ActDecision = (typeof ACT_DECISIONS)[number];

/** Resume signal for the user_confirm wait. Notes are required unless the merchant holds. */
export const ResumeSignalSchema = z
  .object({
    decision: z.enum(ACT_DECISIONS),
    notes: z.string().max(NOTES_MAX, `Notes must be ${NOTES_MAX} characters or fewer.`).default(""),
  })
  .superRefine((v, ctx) => {
    if (v.decision !== "hold" && v.notes.trim() === "") {
      ctx.addIssue({ code: "custom", path: ["notes"], message: "Write a response before sending it to PayPal." });
    }
  });
export type ResumeSignal = z.infer<typeof ResumeSignalSchema>;

export type LinkMethod = "capture" | "handoff" | "none";

export interface DisputeLink {
  method: LinkMethod;
  slipId: string | null;
}

/** Display copy of a second-look handoff record (never cited, never sent to a model). */
export interface HandoffContext {
  captureId: string;
  orderId: string | null;
  slipId: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  riskScore: number | null;
  tactics: string[];
  status: string | null;
}

export interface PackDigest {
  /** Blob ref of the pinned EvidencePack JSON. */
  ref: string;
  chainOk: boolean;
  brokenAtSeq: number | null;
  eventCount: number;
  headHash: string | null;
  summary: string;
  generatedAt: string;
}

export type EvidenceType = "PROOF_OF_FULFILLMENT" | "PROOF_OF_REFUND" | "OTHER";

export interface DraftDocument {
  name: string;
  contentType: string;
  bytes: number;
  sha256: string;
  /** Blob ref holding the base64 body. */
  ref: string;
}

export interface DraftState {
  notes: string;
  documents: DraftDocument[];
  evidenceType: EvidenceType;
}

export type OutcomeKind = "evidence_sent" | "claim_accepted" | "held" | "not_actionable";

export interface Outcome {
  kind: OutcomeKind;
  decision: ActDecision;
  paypalStatus: string | null;
  ledgerSeq: number | null;
  message: string;
}

export type DisputeDeskState = {
  disputeId: string;
  dispute: RailDispute | null;
  link: DisputeLink | null;
  handoff: HandoffContext | null;
  pack: PackDigest | null;
  claim: BuyerClaim | null;
  recommendation: Recommendation | null;
  draft: DraftState | null;
  confirmError: string | null;
  outcome: Outcome | null;
  warnings: string[];
};

/** One record per dispute in store.collection("dispute-desk", "cases"); feeds the board. */
export interface DisputeCase {
  disputeId: string;
  runId: string;
  slipId: string | null;
  linkMethod: LinkMethod;
  decision: Decision | null;
  confidence: number | null;
  outcome: OutcomeKind | null;
  paypalStatus: string | null;
  updatedAt: string;
}

/** wait.data for the user_confirm wait (read by the page and by the generic WaitPanel). */
export interface ConfirmWaitData {
  confirmLabel: string;
  declineLabel: string;
  disputeId: string;
  suggestedDecision: ActDecision;
  recommendation: Recommendation;
  notes: string;
  notesMax: number;
  documents: Omit<DraftDocument, "ref">[];
  evidenceType: EvidenceType;
  error: string | null;
}

export function initialState(input: DisputeDeskInput): DisputeDeskState {
  return {
    disputeId: input.disputeId,
    dispute: null,
    link: null,
    handoff: null,
    pack: null,
    claim: null,
    recommendation: null,
    draft: null,
    confirmError: null,
    outcome: null,
    warnings: [],
  };
}
