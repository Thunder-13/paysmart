/** Display metadata for the shop pipeline. Client-safe. */
export const SHOP_META = {
  title: "Permission Slip shopping",
  tagline:
    "Say what the agent may buy in plain words. PayPal holds exactly that much, a guard the agent can't talk to stamps every cart, and whatever isn't spent goes back to you.",
  primitives: [
    "Orders v2 AUTHORIZE",
    "Payments v2 capture (final)",
    "Payments v2 void",
    "Payments v2 refund",
    "Payouts v1",
    "Channel3 search",
    "Claude tool use",
    "Quarantined extractor",
    "Claude vision",
    "Web Speech",
  ],
} as const;
