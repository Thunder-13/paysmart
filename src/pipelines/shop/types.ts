/**
 * Shop pipeline types and resume-signal schemas. Client-safe: no server or node imports.
 */
import { z } from "zod";
import {
  ClauseSchema,
  FactValueSchema,
  PrincipalSchema,
  type CompiledSlip,
  type EvidencePack,
  type EvidenceRef,
  type Money,
  type NewProposal,
  type Principal,
  type Verdict,
} from "@/core/contracts";
import type { AffiliateLink } from "@/core/affiliate";

export const DEMO_INTENT =
  "Birthday gift for my nephew Leo, turning 6, loves dinosaurs. Under $60. Has to arrive by Saturday. Nothing that needs batteries.";

export const ShopInputSchema = z.object({
  intent: z.string().trim().min(5).max(600).default(DEMO_INTENT),
  principal: PrincipalSchema.default({ name: "Demo shopper", email: null }),
  redTeam: z.boolean().default(false),
  hireHelper: z.boolean().default(false),
});
export type ShopInput = z.infer<typeof ShopInputSchema>;

export type ListingSource = "channel3" | "fixture" | "planted";

/** One product offer the agent can name by id. Description is untrusted seller text. */
export interface Listing {
  id: string;
  title: string;
  description: string;
  price: Money;
  compareAtPrice: Money | null;
  domain: string;
  url: string | null;
  /** Set by search_products from the owner's affiliate accounts. Never shown to the agent. */
  affiliate: AffiliateLink | null;
  availability: string;
  source: ListingSource;
}

export type Outcome = "settled" | "refunded" | "cancelled" | "no_cart" | "blocked" | "capture_failed";

export interface CartLine {
  listingId: string;
  title: string;
  quantity: number;
  unitPrice: Money;
  domain: string;
  source: ListingSource;
  url: string | null;
  affiliate: AffiliateLink | null;
}

/** Most guard-stamped carts the agent can put on the list for the person to choose from. */
export const MAX_OPTIONS = 3;

/** One cart the guard stamped WITHIN or ASK. Never OUTSIDE. */
export interface ShopOption {
  /** "opt-1", "opt-2", ... in proposal order. Stable after sorting. */
  id: string;
  /** 1-based position after sorting: WITHIN first, then ASK, proposal order inside each group. */
  rank: number;
  /** What the guard evaluated. */
  proposal: NewProposal;
  lines: CartLine[];
  verdict: Verdict;
  /** The agent's one-line reason. Display only: the guard never reads it. */
  rationale: string;
}

/** A cart the guard stamped OUTSIDE. Shown, never selectable. */
export interface RuledOut {
  /** Joined line titles, quoted from listings. */
  title: string;
  amount: Money;
  clauseIds: string[];
}

export type HelperStatus = "accepted" | "rejected" | "paid" | "payout_failed" | "released";

export interface HelperRecord {
  childSlipId: string;
  role: "card_writer";
  helperName: string;
  brief: string;
  message: string;
  accepted: boolean;
  detail: string;
  evidence: EvidenceRef;
  payee: string;
  fee: Money;
  payoutBatchId: string | null;
  status: HelperStatus;
}

export interface ShopTotals {
  held: Money;
  captured: Money;
  released: Money;
  refunded: Money;
}

export const DeliveryCheckSchema = z.object({
  breaches: z.array(z.object({ clauseId: z.string(), observation: z.string() })),
  confidence: z.enum(["low", "medium", "high"]),
  summary: z.string(),
});
export type DeliveryCheck = z.infer<typeof DeliveryCheckSchema>;

export type ShopState = {
  intent: string;
  principal: Principal;
  redTeam: boolean;
  hireHelper: boolean;
  catalogSource: "channel3" | "fixtures";
  compiled: CompiledSlip | null;
  /** Shown on a re-wait when the user's last answer could not be used. */
  problem: string | null;
  proposals: number;
  cart: NewProposal | null;
  cartLines: CartLine[];
  cartVerdict: Verdict | null;
  /** Guard-stamped carts the person can choose from. state.cart mirrors the selected one. */
  options: ShopOption[];
  ruledOut: RuledOut[];
  chosenOptionId: string | null;
  affiliate: AffiliateRecord | null;
  helper: HelperRecord | null;
  approvedVia: "click" | "keyboard" | "voice" | null;
  captureId: string | null;
  totals: ShopTotals | null;
  delivery: { photoRef: string; sample: boolean; check: DeliveryCheck } | null;
  refundId: string | null;
  evidencePack: EvidencePack | null;
  outcome: Outcome | null;
  note: string | null;
};

/* ---------------------------------------------------------- resume signals */

export const ConfirmSlipSignalSchema = z.object({
  approved: z.boolean(),
  clauses: z.array(z.unknown()).optional(),
});

export const PayPalReturnSignalSchema = z.object({
  approved: z.boolean(),
  orderId: z.string().nullable().optional(),
});

/** Facts the user may vouch for when the guard answers ASK. */
export const ATTESTABLE_FIELDS = ["deliveryEstimate", "inStock", "category", "itemCount"] as const;

export const AttestationSchema = z.object({
  /** Which cart line; omitted means every line where the fact is unknown. */
  itemIndex: z.number().int().min(0).optional(),
  /** "deliveryEstimate" | "inStock" | "category" | "itemCount" | "attributes.<name>" */
  field: z.string().min(1),
  value: FactValueSchema,
});
export type Attestation = z.infer<typeof AttestationSchema>;

export const ConfirmCartSignalSchema = z.object({
  approved: z.boolean(),
  /** Which option to buy. Missing means the default option (first WITHIN, else first ASK). */
  optionId: z.string().min(1).optional(),
  via: z.enum(["click", "keyboard", "voice"]).optional(),
  attestations: z.array(AttestationSchema).optional(),
});

export const DeliverySignalSchema = z.object({
  ref: z.string().optional(),
  blobRef: z.string().optional(),
  contentType: z.string().optional(),
  sample: z.boolean().optional(),
  skip: z.boolean().optional(),
});

export const ConfirmRefundSignalSchema = z.object({ approved: z.boolean() });

/** Clause re-export for the clause editor. */
export { ClauseSchema };

/** Commission bookkeeping for a settled cart. Estimates only; the network pays out later. */
export interface AffiliateRecord {
  lines: { listingId: string; network: string; accountId: string; url: string; lineTotal: Money; estCommission: Money | null }[];
  estCommission: Money | null;
  reversed: boolean;
}
