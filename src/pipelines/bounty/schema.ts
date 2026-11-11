/**
 * Bounty pipeline shapes: run inputs (bounty or pledge), resume signals, run state, and the
 * pipeline-owned records in store.collection("bounty", "bounties" | "proofs").
 */
import { z } from "zod";
import { MoneySchema, type EvidenceRef, type Money, type Principal } from "@/core/contracts";

export const BOUNTY_COLLECTION = "bounties";
export const PROOF_COLLECTION = "proofs";

export { NEAR_DUPLICATE_BITS } from "./dhash";
/** Capture times may run this far ahead of the server clock (phone clock drift). */
export const CLOCK_SKEW_MS = 2 * 60_000;

export const REWARD_MIN = "1.00";
export const REWARD_MAX = "500.00";
export const PLEDGE_MIN = "1.00";
export const DEADLINE_MIN_MS = 60 * 60_000;
export const DEADLINE_MAX_MS = 72 * 60 * 60_000;

const PersonSchema = z.object({
  name: z.string().trim().min(1).max(60),
  email: z.email().nullable(),
});

export const LocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusM: z.number().int().min(25).max(2000),
});
export type JobSite = z.infer<typeof LocationSchema>;

export const CreateBountyInputSchema = z.object({
  kind: z.literal("bounty"),
  title: z.string().trim().min(3).max(80),
  description: z.string().trim().min(10).max(1000),
  reward: MoneySchema,
  deadline: z.iso.datetime({ offset: true }),
  location: LocationSchema.nullable(),
  organizer: PersonSchema,
});
export type CreateBountyInput = z.infer<typeof CreateBountyInputSchema>;

export const PledgeInputSchema = z.object({
  kind: z.literal("pledge"),
  bountyId: z.string().min(1),
  backer: PersonSchema,
  amount: MoneySchema,
});
export type PledgeInput = z.infer<typeof PledgeInputSchema>;

export const BountyPipelineInputSchema = z.discriminatedUnion("kind", [CreateBountyInputSchema, PledgeInputSchema]);
export type BountyPipelineInput = z.infer<typeof BountyPipelineInputSchema>;

/* ------------------------------------------------------------- signals */

export const HEX64_RE = /^[0-9a-f]{16}$/;

export const PhotoSchema = z.object({
  blobRef: z.string().min(1),
  capturedAt: z.iso.datetime({ offset: true }),
  dHash: z.string().regex(HEX64_RE, "dHash must be 16 lowercase hex characters"),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});
export type ProofPhoto = z.infer<typeof PhotoSchema>;

export const ProofSubmissionSchema = z.object({ before: PhotoSchema, after: PhotoSchema });
export type ProofSubmission = z.infer<typeof ProofSubmissionSchema>;

export const BountySignalSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("pledge") }),
  z.object({ event: z.literal("tick") }),
  z.object({ event: z.literal("cancel") }),
  z.object({ event: z.literal("claim"), workerName: z.string().trim().min(1).max(60), workerEmail: z.email() }),
  z.object({ event: z.literal("proof"), before: PhotoSchema, after: PhotoSchema }),
  z.object({ event: z.literal("payout_retry") }),
  z.object({ event: z.literal("payout_refund") }),
]);
export type BountySignal = z.infer<typeof BountySignalSchema>;

export const PledgeSignalSchema = z.object({ approved: z.boolean(), orderId: z.string().nullable().optional() });

export type ParsedSignal = { ok: true; signal: BountySignal } | { ok: false; reason: string };

/**
 * Bounty-run signals. WaitPanel's confirm buttons send {approved}, which maps to the payout
 * retry/refund choice; anything else must match BountySignalSchema.
 */
export function parseBountySignal(raw: unknown): ParsedSignal {
  if (raw && typeof raw === "object" && !("event" in raw) && "approved" in raw) {
    const approved = (raw as { approved: unknown }).approved;
    if (typeof approved === "boolean") return { ok: true, signal: { event: approved ? "payout_retry" : "payout_refund" } };
  }
  const parsed = BountySignalSchema.safeParse(raw);
  if (parsed.success) return { ok: true, signal: parsed.data };
  const event = raw && typeof raw === "object" && "event" in raw ? String((raw as { event: unknown }).event) : "nothing";
  const issue = parsed.error.issues[0];
  const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
  return { ok: false, reason: `That ${event} signal was refused (${where}${issue?.message ?? "invalid"}).` };
}

/* --------------------------------------------------------------- state */

export type CloseReason = "expired" | "cancelled";

/** One flat state for both run kinds; `kind` says which fields are in use. */
export type BountyState = {
  kind: "bounty" | "pledge";
  bounty: CreateBountyInput | null;
  pledge: PledgeInput | null;
  bountyId: string | null;
  payoutSlipId: string | null;
  pledgeSlipId: string | null;
  pledgeAmount: Money | null;
  outcome: "held" | "declined" | "voided_late" | null;
  closeReason: CloseReason | null;
  lastRejection: string | null;
};

export function initialState(input: BountyPipelineInput): BountyState {
  return {
    kind: input.kind,
    bounty: input.kind === "bounty" ? input : null,
    pledge: input.kind === "pledge" ? input : null,
    bountyId: input.kind === "pledge" ? input.bountyId : null,
    payoutSlipId: null,
    pledgeSlipId: null,
    pledgeAmount: null,
    outcome: null,
    closeReason: null,
    lastRejection: null,
  };
}

/* ------------------------------------------------------------- records */

export type BountyStatus =
  | "funding"
  | "funded"
  | "claimed"
  | "verified"
  | "paid"
  | "settle_failed"
  | "payout_failed"
  | "refunded"
  | "expired"
  | "cancelled";

/** Statuses after which no money moves and no pledge is held. */
export const CLOSED_BOUNTY_STATUSES: BountyStatus[] = ["paid", "settle_failed", "refunded", "expired", "cancelled"];
/** Statuses a deadline or cancel can still close. */
export const CLOSABLE_BOUNTY_STATUSES: BountyStatus[] = ["funding", "funded", "claimed"];

export type CheckStatus = "pass" | "fail" | "skipped";

export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface ProofAttempt {
  at: string;
  pass: boolean;
  results: CheckResult[];
  beforeRef: string;
  afterRef: string;
}

export interface CaptureLine {
  slipId: string;
  backer: string;
  amount: Money;
  captureId: string;
}

export interface Bounty {
  id: string;
  runId: string;
  payoutSlipId: string;
  title: string;
  description: string;
  reward: Money;
  deadline: string;
  location: JobSite | null;
  organizer: Principal;
  rubric: string;
  checks: { id: string; label: string }[];
  shots: { before: string; after: string };
  status: BountyStatus;
  claim: { workerName: string; workerEmail: string; claimedAt: string } | null;
  attempts: ProofAttempt[];
  /** The passing before_after_photos evidence, reused on every capture and the payout. */
  evidence: EvidenceRef | null;
  captures: CaptureLine[];
  payout: { batchId: string; status: string; amount: Money; receiverEmail: string } | null;
  failure: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProofRow {
  id: string;
  bountyId: string;
  bountyTitle: string;
  role: "before" | "after";
  blobRef: string;
  sha256: string;
  dHash: string;
  capturedAt: string;
  lat: number | null;
  lng: number | null;
  submittedAt: string;
  passed: boolean;
}
