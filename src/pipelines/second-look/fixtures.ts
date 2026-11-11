/**
 * Three original sample conversations for the demo and tests, each with the analysis the scripted
 * (mock) model returns for it. Pure data, safe to import from client components.
 */
import type { Money } from "@/core/contracts";
import type { ModelAnalysis } from "./types";

export type FixtureId = "scam" | "legit" | "borderline";

export interface Fixture {
  id: FixtureId;
  label: string;
  chatText: string;
  listingText: string;
  sellerEmail: string;
  amount: Money;
  /** What the mock model says about this conversation. */
  script: Omit<ModelAnalysis, "transcript">;
}

const SCAM_CHAT = [
  "Dana: hi! yes the PS5 is still available",
  "Buyer: great, can we meet at the library so I can see it?",
  "Dana: sorry I'm out of town for work, I can't meet. I'll ship it today",
  "Dana: just send it friends and family so PayPal doesn't take a cut",
  "Dana: price is $180 today only, two other people want it",
  "Buyer: can I pay with goods and services instead?",
  "Dana: if you're serious send it now and I'll ship tonight",
].join("\n");

const SCAM_LISTING = [
  "PS5 Disc Edition, barely used, two controllers",
  "Asking $180. Shipping only, no local pickup.",
].join("\n");

const LEGIT_CHAT = [
  "Priya: Hi! Yes, the 50mm lens is still available.",
  "Buyer: Great. I'm a few states away, could you ship it?",
  "Priya: Sure, I ship with USPS and send the tracking number the same day.",
  "Buyer: Can I pay through goods and services?",
  "Priya: Of course, that protects us both. Send it to my account email and I'll box it up.",
  "Priya: The wireless remote is in the box too.",
].join("\n");

const LEGIT_LISTING = [
  "Canon EF 50mm f/1.8 STM lens, used, clean glass",
  "Front and rear caps and a wireless remote included. $120 shipped, tracked.",
].join("\n");

const BORDERLINE_CHAT = [
  "Jordan: Hey, I still have the two tickets for Saturday.",
  "Buyer: Nice. Could we meet so I can see them first?",
  "Jordan: I moved out of state, so I can only transfer them through the ticket app.",
  "Jordan: Lots of interest, so let me know soon.",
  "Buyer: Can I pay through goods and services?",
  "Jordan: I guess, as long as it's quick.",
].join("\n");

const BORDERLINE_LISTING = ["2 tickets, Saturday show, section 104 row F", "$150 for both, below face value."].join("\n");

export const FIXTURES: Record<FixtureId, Fixture> = {
  scam: {
    id: "scam",
    label: "Scam sample",
    chatText: SCAM_CHAT,
    listingText: SCAM_LISTING,
    sellerEmail: "dana.deals@example.com",
    amount: { currency: "USD", value: "180.00" },
    script: {
      tactics: [
        {
          id: "ff_request",
          quote: "Dana: just send it friends and family so PayPal doesn't take a cut",
          why: "Friends and Family payments are not covered by Purchase Protection.",
        },
        {
          id: "urgency",
          quote: "Dana: price is $180 today only, two other people want it",
          why: "A same-day deadline and other buyers push you to pay before checking.",
        },
        {
          id: "ship_only",
          quote: "Dana: sorry I'm out of town for work, I can't meet. I'll ship it today",
          why: "The seller will not meet or show the console.",
        },
        {
          id: "too_good_price",
          quote: "Asking $180. Shipping only, no local pickup.",
          why: "$180 is far below what this console usually sells for.",
        },
      ],
      riskScore: 86,
      headline: "This chat has four classic scam signs",
      explanation:
        "The seller wants Friends and Family, which has no purchase protection, won't meet, prices the console well under market, and says the deal ends today. Offer a goods and services payment. An honest seller will take it.",
    },
  },
  legit: {
    id: "legit",
    label: "Legit seller sample",
    chatText: LEGIT_CHAT,
    listingText: LEGIT_LISTING,
    sellerEmail: "priya.lens@example.com",
    amount: { currency: "USD", value: "120.00" },
    script: {
      tactics: [],
      riskScore: 8,
      headline: "No scam signs in this chat",
      explanation:
        "The seller offers tracked shipping and agrees to a goods and services payment without pushback. Pay the protected way anyway, and keep the tracking number.",
    },
  },
  borderline: {
    id: "borderline",
    label: "Borderline sample",
    chatText: BORDERLINE_CHAT,
    listingText: BORDERLINE_LISTING,
    sellerEmail: "jordan.tix@example.com",
    amount: { currency: "USD", value: "150.00" },
    script: {
      tactics: [
        {
          id: "ship_only",
          quote: "Jordan: I moved out of state, so I can only transfer them through the ticket app.",
          why: "You can't see the tickets before you pay.",
        },
        {
          id: "urgency",
          quote: "Jordan: Lots of interest, so let me know soon.",
          why: "Mild pressure to decide fast.",
        },
      ],
      riskScore: 44,
      headline: "Some warning signs, nothing certain",
      explanation:
        "The seller can't meet and nudges you to hurry, but did agree to goods and services. Pay only the protected way and don't let the seller switch the payment method.",
    },
  },
};

export const FIXTURE_IDS: FixtureId[] = ["scam", "legit", "borderline"];
