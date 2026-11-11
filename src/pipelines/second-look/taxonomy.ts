/**
 * Second Look vocabulary: the fixed scam-tactic taxonomy, detector weights, risk bands, carriers.
 * Pure data, safe to import from client components.
 */
import { z } from "zod";

export const TACTIC_IDS = [
  "ff_request",
  "urgency",
  "off_platform",
  "too_good_price",
  "ship_only",
  "overpayment",
  "gift_card_or_crypto",
  "identity_mismatch",
  "refuses_protection",
  "advance_fee",
] as const;
export const TacticIdSchema = z.enum(TACTIC_IDS);
export type TacticId = z.infer<typeof TacticIdSchema>;

/** Chip text shown to the buyer. */
export const TACTIC_LABELS: Record<TacticId, string> = {
  ff_request: "Friends and Family request",
  urgency: "Pressure to hurry",
  off_platform: "Off-platform payment",
  too_good_price: "Price too good",
  ship_only: "Won't meet, ship only",
  overpayment: "Overpayment trick",
  gift_card_or_crypto: "Gift card or crypto",
  identity_mismatch: "Name or account mismatch",
  refuses_protection: "Refuses buyer protection",
  advance_fee: "Deposit or fee first",
};

/** One-line definitions, used in the analysis prompt. */
export const TACTIC_HINTS: Record<TacticId, string> = {
  ff_request: "asks for a Friends and Family payment, or to send it as a gift, to skip fees",
  urgency: "pushes the buyer to pay fast: today only, other buyers waiting, deadline",
  off_platform: "moves payment or talk off the marketplace: wire, Zelle, Cash App, WhatsApp, text me",
  too_good_price: "price far below what the item usually sells for",
  ship_only: "will not meet or show the item, insists on shipping or remote transfer",
  overpayment: "sends or offers extra money and asks for the difference back",
  gift_card_or_crypto: "asks for gift cards, crypto or another untraceable payment",
  identity_mismatch: "name, account or payee email does not match the seller",
  refuses_protection: "refuses goods and services or any buyer protection",
  advance_fee: "asks for a deposit, holding fee or shipping fee before the sale",
};

/** Weight each detector-found tactic adds to the deterministic score floor (D2). */
export const DETECTOR_WEIGHTS: Partial<Record<TacticId, number>> = {
  ff_request: 40,
  gift_card_or_crypto: 45,
  advance_fee: 35,
  off_platform: 25,
  urgency: 20,
};

export const RISK_BANDS = ["low", "caution", "high"] as const;
export type RiskBand = (typeof RISK_BANDS)[number];

export const CAUTION_AT = 30;
export const HIGH_AT = 60;
/** Family alerts fire at this score or above. */
export const ALERT_AT = HIGH_AT;

export function bandOf(score: number): RiskBand {
  if (score >= HIGH_AT) return "high";
  if (score >= CAUTION_AT) return "caution";
  return "low";
}

export const BAND_WORDS: Record<RiskBand, string> = {
  low: "Low risk",
  caution: "Be careful",
  high: "High risk",
};

/** Carriers accepted by the tracking form (PayPal carrier codes). */
export const CARRIERS = ["USPS", "UPS", "FEDEX", "DHL", "OTHER"] as const;
export const CarrierSchema = z.enum(CARRIERS);
export type Carrier = z.infer<typeof CarrierSchema>;

/** Slip clause ids (D1). */
export const CLAUSE_IDS = { payee: "c1", budget: "c2", evidence: "c3", expiry: "c4" } as const;

/** Slip lifetime: the buyer has this long to finish paying. */
export const SLIP_HOURS = 72;

/** Screenshots above this size are skipped (model image limit). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const RETURN_PATH = "/p/second-look";
