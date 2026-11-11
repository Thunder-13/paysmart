/**
 * PaySmart types and resume-signal schemas. FROZEN by the orchestrator (Stage 6.0):
 * the pipeline worker and the UI worker both build against this file. Need a change?
 * Put it under "Requests" in your report. Client-safe: no server or node imports.
 * Design: openspec/changes/add-paysmart-pipeline/design.md
 */
import { z } from "zod";
import {
  PrincipalSchema,
  type CompiledSlip,
  type EvidencePack,
  type ExtractedFacts,
  type Money,
  type PipelineId,
  type Principal,
} from "@/core/contracts";
import type { AffiliateLink } from "@/core/affiliate";
import {
  AttestationSchema,
  type DeliveryCheck,
  type ListingSource,
  type RuledOut,
  type ShopOption,
} from "@/pipelines/shop/types";

export const PAYSMART_DEMO_ASK =
  "Birthday gift for my nephew Leo, turning 6, loves dinosaurs, plus a birthday card to go with it. Under $60 total. Has to arrive by Saturday. Nothing that needs batteries.";

/** Example asks for the UI chips. One per route, so the front door shows every use case. */
export const PAYSMART_EXAMPLES: { label: string; ask: string }[] = [
  { label: "Gift + card under $60", ask: PAYSMART_DEMO_ASK },
  {
    label: "Pay a stranger",
    ask: "A guy on Marketplace is selling me a PS5 for $320 and wants me to pay by friends and family first.",
  },
  { label: "Split a job", ask: "Pool $40 with my neighbors to get the shared hedge trimmed this week." },
  { label: "Can I afford it", ask: "Show me my cash forecast and nudge the clients with late invoices." },
  { label: "Paid research", ask: "Let my research agent read paywalled articles on battery recycling, 15 cents max." },
  { label: "A dispute", ask: "A customer opened a PayPal dispute saying the dinosaur toy never arrived." },
];

/** Hard cap on one ask in this build. Bigger asks are sent back with a clarify question. */
export const PAYSMART_MAX_LIMIT: Money = { currency: "USD", value: "1000.00" };
/** Most basket lines one ask can turn into. */
export const MAX_NEEDS = 4;
/** Most guard-stamped carts on the choice screen. Same rule as Shop. */
export const MAX_OPTIONS = 3;
/** Most clarify rounds before the run stops with outcome "blocked". */
export const MAX_CLARIFY = 2;
/** Listings PaySmart asks for per search. */
export const RESULTS_PER_SEARCH = 12;
/** Eligible listings per need that discovery inspects (quarantined facts) before carts are built. */
export const INSPECT_PER_NEED = 5;

export const PaySmartInputSchema = z.object({
  ask: z.string().trim().min(5).max(600).default(PAYSMART_DEMO_ASK),
  principal: PrincipalSchema.default({ name: "Demo shopper", email: null }),
  /** Plants the Shop hijack listing (and, on live Channel3, the scam marketplace seller). */
  redTeam: z.boolean().default(false),
  /** "voice" when the ask was dictated in the browser. Display and ledger only. */
  askVia: z.enum(["typed", "voice"]).default("typed"),
});
export type PaySmartInput = z.infer<typeof PaySmartInputSchema>;

/* ------------------------------------------------------------ routing */

export const USE_CASES = ["buy", "pay_person", "group_buy", "cash_check", "paid_research", "dispute"] as const;
export const UseCaseSchema = z.enum(USE_CASES);
export type UseCase = z.infer<typeof UseCaseSchema>;

/** Front-door map: every non-buy ask goes to the pipeline built for it. */
export const USE_CASE_ROUTES: Record<Exclude<UseCase, "buy">, { pipeline: PipelineId; path: string; label: string }> = {
  pay_person: { pipeline: "second-look", path: "/p/second-look", label: "Second Look checks a payment to a stranger before you send it" },
  group_buy: { pipeline: "bounty", path: "/p/bounty", label: "Bounty Board pools money for a job and pays on photo proof" },
  cash_check: { pipeline: "cash-weather", path: "/p/cash-weather", label: "Cash Weather forecasts your cash and nudges late invoices" },
  paid_research: { pipeline: "toll-road", path: "/p/toll-road", label: "Toll Road lets an agent pay per article under a small slip" },
  dispute: { pipeline: "dispute-desk", path: "/p/dispute-desk", label: "Dispute Desk answers a dispute from the slip's evidence" },
};

/** One basket line the ask asks for. "query" is what the agent searches first. */
export const NeedSchema = z.object({
  need: z.string().trim().min(1).max(80),
  query: z.string().trim().min(2).max(120),
  quantity: z.number().int().min(1).max(5),
});
export type Need = z.infer<typeof NeedSchema>;

/** Output of the router (one no-tool ai.json call, deterministic mock). */
export const RouteDecisionSchema = z.object({
  useCase: UseCaseSchema,
  needs: z.array(NeedSchema).max(MAX_NEEDS),
  /** A question for the person when the ask cannot be acted on as written. */
  clarify: z.string().trim().max(200).nullable(),
  summary: z.string().trim().max(200),
});
export type RouteDecision = z.infer<typeof RouteDecisionSchema>;

export interface Handoff {
  useCase: Exclude<UseCase, "buy">;
  pipeline: PipelineId;
  path: string;
  label: string;
  /** Plain words: why this ask went there. */
  why: string;
  /** Verbatim lines from the ask that triggered the route (Second Look detector quotes). */
  quotes: string[];
}

/* ------------------------------------------------------------ screens */

/**
 * Internal screens. Each one runs logic that already exists in another pipeline:
 *   request    Permission Slip compile + slip checks on the ask itself, and Second Look
 *              detectors on the ask (payment-method red flags route to Second Look)
 *   integrity  Permission Slip extractor quarantine and injection detection on listing text
 *   seller     Second Look scam-tactic detectors on seller text
 *   slip       Permission Slip guard: every product and every cart against the clauses
 */
export const SCREEN_IDS = ["request", "integrity", "seller", "slip"] as const;
export type ScreenId = (typeof SCREEN_IDS)[number];

export const SCREEN_SOURCES: Record<ScreenId, { pipeline: PipelineId; label: string }> = {
  request: { pipeline: "shop", label: "Permission Slip: can this ask become a valid slip" },
  integrity: { pipeline: "shop", label: "Permission Slip quarantine: hidden instructions in listing text" },
  seller: { pipeline: "second-look", label: "Second Look: scam tactics in seller text" },
  slip: { pipeline: "shop", label: "Permission Slip guard: your clauses" },
};

export type ScreenStatus = "pass" | "fail" | "ask" | "skipped";

export interface ScreenResult {
  screen: ScreenId;
  status: ScreenStatus;
  /** Plain words for the person. */
  reason: string;
  /** Slip screen: clause ids the guard cited ("integrity" included). Empty otherwise. */
  clauseIds: string[];
  /** Integrity and seller screens: the verbatim line that matched, clipped to 160 chars. */
  quote: string | null;
}

/**
 * eligible:  passed every screen that ran, and the slip screen is "pass"
 * ruled_out: some screen is "fail"; never offered, never sent to the agent again
 * needs_you: no fail, slip screen is "ask" (a fact the slip depends on is unknown)
 * unchecked: passed integrity and seller, never inspected, so the slip screen is "skipped"
 */
export type ProductStatus = "eligible" | "ruled_out" | "needs_you" | "unchecked";

/** One scraped listing on the product board, with every screen it went through. */
export interface ProductCard {
  listingId: string;
  /** Which basket need's search found it first, or null. */
  need: string | null;
  title: string;
  price: Money;
  domain: string;
  url: string | null;
  source: ListingSource;
  /** Owner's affiliate link, same rule as Shop. Never shown to the agent. */
  affiliate: AffiliateLink | null;
  /** Quarantined facts, once inspected. */
  facts: ExtractedFacts | null;
  screens: ScreenResult[];
  status: ProductStatus;
}

/**
 * One search PaySmart ran during discovery, shown to the person as a lane on the board.
 * PaySmart runs these itself, one per need, from the ask; the cart-building agent never searches.
 */
export interface SearchRun {
  /** "s-1", "s-2", ... in run order. */
  id: string;
  /** The need this search serves (NeedSchema.need), so the board groups products by need. */
  need: string;
  query: string;
  source: "channel3" | "fixtures";
  /** Price cap sent with the search: the slip's limit. */
  maxPrice: Money;
  at: string;
  /** Listings the search returned. */
  found: number;
  /** Failed the integrity or seller screen. */
  ruledOut: number;
  /** Passed both screens: what the agent and the person see for this need. */
  shown: number;
  /** Of the shown ones, how many discovery inspected (quarantined facts + slip stamp). */
  inspected: number;
  /** Every listing id the search returned, in result order. */
  listingIds: string[];
}

/** found >= clean >= trusted >= withinSlip; inCarts counts distinct listings in options. */
export interface Funnel {
  found: number;
  clean: number;
  trusted: number;
  withinSlip: number;
  inCarts: number;
}

/** A guard-stamped cart option (WITHIN or ASK, never OUTSIDE). Same shape as Shop's. */
export type PaySmartOption = ShopOption;
export type PaySmartRuledOut = RuledOut;

/* ------------------------------------------------------------ outcome */

export type PaySmartOutcome =
  | "paid"
  | "refunded"
  | "cancelled"
  | "no_options"
  | "blocked"
  | "capture_failed"
  | "handed_off";

export interface PaySmartTotals {
  /** The budget_max clause: the most the ask allows. */
  limit: Money;
  /** What PayPal held: the chosen cart's total, not the limit. */
  held: Money;
  captured: Money;
  released: Money;
  refunded: Money;
}

export type PaySmartStage = "clarify" | "choose" | "sign" | "delivery" | "refund";

export type PaySmartState = {
  ask: string;
  principal: Principal;
  redTeam: boolean;
  catalogSource: "channel3" | "fixtures";
  route: RouteDecision | null;
  /** The person's clarify answers, in order. Appended to the ask for the next routing pass. */
  clarifications: string[];
  /** Results of the request screen, shown above the board. */
  requestScreen: ScreenResult[];
  compiled: CompiledSlip | null;
  /** How the ask arrived. Voice asks are dictated in the browser and sent as text. */
  askVia: "typed" | "voice";
  /** Discovery searches, one per need, appended as each lands. */
  searches: SearchRun[];
  /** Index into route.needs of the next need discovery will search. */
  discoverCursor: number;
  products: ProductCard[];
  funnel: Funnel | null;
  options: PaySmartOption[];
  ruledOut: PaySmartRuledOut[];
  chosenOptionId: string | null;
  approvedVia: "click" | "keyboard" | "voice" | null;
  /** The amount PayPal was asked to hold (chosen cart total). */
  hold: Money | null;
  captureId: string | null;
  totals: PaySmartTotals | null;
  delivery: { photoRef: string; sample: boolean; check: DeliveryCheck } | null;
  refundId: string | null;
  evidencePack: EvidencePack | null;
  handoff: Handoff | null;
  /** Shown on a re-wait when the last answer could not be used. */
  problem: string | null;
  outcome: PaySmartOutcome | null;
  note: string | null;
};

/* ------------------------------------------------------- resume signals */

export const ClarifySignalSchema = z.union([
  z.object({ answer: z.string().trim().min(1).max(300) }),
  z.object({ cancel: z.literal(true) }),
]);

export const ChooseSignalSchema = z.object({
  approved: z.boolean(),
  /** Missing means the default option (first WITHIN, else first ASK). */
  optionId: z.string().min(1).optional(),
  via: z.enum(["click", "keyboard", "voice"]).optional(),
  /** Edited clauses. When present and changed, every product and option is re-stamped and the run waits again. */
  clauses: z.array(z.unknown()).optional(),
  attestations: z.array(AttestationSchema).optional(),
});

export {
  PayPalReturnSignalSchema,
  DeliverySignalSchema,
  ConfirmRefundSignalSchema,
  AttestationSchema,
} from "@/pipelines/shop/types";
