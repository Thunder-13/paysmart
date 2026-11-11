/** Second Look schemas and shared types (input, model output, analysis, run state, signals). */
import { z } from "zod";
import { MoneySchema, PrincipalSchema, type Money, type Verdict } from "@/core/contracts";
import { toCents } from "@/core/money";
import { CarrierSchema, TacticIdSchema, type RiskBand, type TacticId } from "./taxonomy";

/* ---------------------------------------------------------------- input */

/** "" and whitespace-only become undefined, so empty form fields count as absent. */
function blankToUndefined(v: unknown): unknown {
  return typeof v === "string" && v.trim() === "" ? undefined : v;
}

const EmailSchema = z.string().trim().toLowerCase().pipe(z.email({ message: "Enter a valid email address." }));

export const SecondLookInputSchema = z
  .object({
    chatText: z.preprocess(blankToUndefined, z.string().max(20_000).optional()),
    screenshotRef: z.preprocess(blankToUndefined, z.string().max(200).optional()),
    listingText: z.string().trim().min(1, "Paste the listing text.").max(10_000),
    sellerEmail: EmailSchema,
    amount: MoneySchema.refine((m) => toCents(m) > 0, { message: "The amount must be more than zero." }),
    principal: PrincipalSchema,
    trustedContactEmail: z.preprocess(blankToUndefined, EmailSchema.optional()),
  })
  .refine((i) => !!i.chatText || !!i.screenshotRef, {
    message: "Paste the chat or drop a screenshot of it.",
    path: ["chatText"],
  });
export type SecondLookInput = z.output<typeof SecondLookInputSchema>;

/* ---------------------------------------------------------- model output */

/** What the model returns (D4). Lengths are trimmed in code, not rejected. */
export const ModelAnalysisSchema = z.object({
  tactics: z.array(
    z.object({
      id: TacticIdSchema,
      quote: z.string(),
      why: z.string(),
    }),
  ),
  riskScore: z.number().int().min(0).max(100),
  headline: z.string(),
  explanation: z.string(),
  /** Visible text read from the screenshot, or null when no image was given. */
  transcript: z.string().nullable(),
});
export type ModelAnalysis = z.infer<typeof ModelAnalysisSchema>;

/* -------------------------------------------------------------- analysis */

export type TacticSource = "rule" | "model" | "both";

export interface Tactic {
  id: TacticId;
  label: string;
  quote: string;
  why: string;
  source: TacticSource;
}

export interface Analysis {
  tactics: Tactic[];
  riskScore: number;
  /** The model's own score before the detector floor. */
  modelScore: number;
  /** Deterministic floor from detector findings. */
  floor: number;
  band: RiskBand;
  headline: string;
  explanation: string;
  /** Plain-words notes: injection found, screenshot skipped, mock mode. */
  notes: string[];
  injectionSuspected: boolean;
  transcript: string | null;
  usedImage: boolean;
}

/* ------------------------------------------------------------- run state */

export const OUTCOMES = [
  "buyer_walked_away",
  "seller_refused",
  "payee_blocked",
  "blocked",
  "payment_cancelled",
  "protected_shipped",
  "shipped_unconfirmed",
  "handed_off",
] as const;
export type Outcome = (typeof OUTCOMES)[number];

export type SecondLookState = {
  input: SecondLookInput;
  analysis: Analysis | null;
  listingTitle: string;
  honestOffer: string;
  /** Payee email the seller asked for when accepting, if different. */
  requestedPayee: string | null;
  verdict: Verdict | null;
  orderId: string | null;
  approveUrl: string | null;
  captureId: string | null;
  tracking: { number: string; carrier: string; confirmed: boolean } | null;
  alertIds: string[];
  handoffId: string | null;
  outcome: Outcome | null;
  recommendation: string | null;
  /** Shown when a resume payload was not understood. */
  notice: string | null;
};

/* --------------------------------------------------------------- signals */

export const OfferSignalSchema = z.union([
  z.object({ action: z.enum(["send_offer", "walk_away"]) }),
  /** WaitPanel's generic user_confirm buttons send {approved}. */
  z.object({ approved: z.boolean() }),
]);

export const SellerSignalSchema = z.discriminatedUnion("response", [
  z.object({
    response: z.literal("accepted"),
    payeeEmail: z.preprocess(blankToUndefined, EmailSchema.optional()),
  }),
  z.object({ response: z.literal("refused"), note: z.string().max(500).optional() }),
]);

export const ApprovalSignalSchema = z.object({
  approved: z.boolean(),
  orderId: z.string().nullable().optional(),
});

export const ShipmentSignalSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("shipped"),
    trackingNumber: z
      .string()
      .trim()
      .min(4, "Enter the tracking number.")
      .max(64)
      .regex(/^[A-Za-z0-9 -]+$/, "Tracking numbers use letters, digits, spaces and dashes."),
    carrier: CarrierSchema,
  }),
  z.object({ event: z.literal("not_arrived") }),
]);

/* --------------------------------------------------- collections (D9) */

export type AlertReason = "high_risk" | "seller_refused";

export interface FamilyAlert {
  id: string;
  to: string;
  slipId: string;
  runId: string;
  reason: AlertReason;
  riskScore: number;
  band: RiskBand;
  headline: string;
  tactics: { id: TacticId; label: string; quote: string }[];
  buyerName: string;
  sellerEmail: string;
  amount: Money;
  createdAt: string;
  read: boolean;
}

/** Read by the Dispute Desk pipeline: store.collection("second-look", "handoffs"). Id = capture id. */
export interface HandoffRecord {
  id: string;
  captureId: string;
  orderId: string | null;
  slipId: string;
  runId: string;
  sellerEmail: string;
  amount: Money;
  reason: "item_not_received";
  trackingNumber: string | null;
  carrier: string | null;
  riskScore: number | null;
  tactics: TacticId[];
  createdAt: string;
  status: "open";
}
