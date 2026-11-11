/** Fixed text templates: the honest offer, recommendations, and the deterministic risk card. */
import type { Money } from "@/core/contracts";
import { formatMoney } from "@/core/money";
import { BAND_WORDS, TACTIC_LABELS, type RiskBand, type TacticId } from "./taxonomy";

export const HONEST_OFFER_LINE = "I'll pay through PayPal goods and services so we're both covered.";

export function honestOffer(input: { listingTitle: string; amount: Money; sellerEmail: string }): string {
  return [
    `Hi! I'd like to buy "${input.listingTitle}".`,
    HONEST_OFFER_LINE,
    `I can send ${formatMoney(input.amount)} to ${input.sellerEmail} as soon as you say yes.`,
  ].join(" ");
}

export const WALK_AWAY_TEXT =
  "The seller would not take a protected payment, and that refusal is the warning sign. Don't send money by Friends and Family, gift card, wire, Zelle or crypto. Walk away from this one.";

export const BUYER_WALKED_AWAY_TEXT = "You chose not to pay. Nothing was sent, and the slip is closed.";

export function payeeBlockedText(requested: string, sellerEmail: string): string {
  return `The seller asked to be paid at ${requested}, but this slip only allows ${sellerEmail}. Paying a different account is a common scam move, so no payment was created.`;
}

export function blockedText(messages: string[]): string {
  return `The payment was stopped before anything moved: ${messages.join(" ")}`;
}

export const PAYMENT_CANCELLED_TEXT = "You backed out on PayPal. No money moved.";

export const PROTECTED_SHIPPED_TEXT =
  "Paid as a protected goods payment, and the tracking number is attached to the payment. If the item never arrives, report it here and the evidence goes to Dispute Desk.";

export function shippedUnconfirmedText(error: string): string {
  return `Paid as a protected goods payment. PayPal did not accept the tracking number (${error}), so it is kept as unconfirmed evidence on the slip.`;
}

export const HANDED_OFF_TEXT =
  "Reported as never arrived. The payment, the chat analysis and the ledger are handed to Dispute Desk as one evidence pack.";

/** Plain-words card built from the final tactics and band, used when the model's text can't be trusted. */
export function deterministicCard(tactics: { id: TacticId }[], band: RiskBand): { headline: string; explanation: string } {
  const names = tactics.map((t) => TACTIC_LABELS[t.id].toLowerCase());
  if (names.length === 0) {
    return {
      headline: `${BAND_WORDS[band]}: no known scam signs found`,
      explanation: "None of the tactics we look for showed up. Pay the protected way anyway, and keep the tracking number.",
    };
  }
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return {
    headline: `${BAND_WORDS[band]}: ${names.length} scam sign${names.length === 1 ? "" : "s"} found`,
    explanation: `We found ${list}. Offer a goods and services payment instead. An honest seller will take it.`,
  };
}
