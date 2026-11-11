/** Display metadata for the PaySmart pipeline. Client-safe. */
export const PAYSMART_META = {
  title: "PaySmart",
  tagline: "Say what you need. The agent shops, every other pipeline screens, you pick, PayPal pays.",
  primitives: [
    "Orders v2 AUTHORIZE",
    "Payments v2 capture (final)",
    "Payments v2 void",
    "Payments v2 refund",
    "Channel3 search",
    "Claude tool use",
    "Quarantined extractor",
    "Claude vision",
    "Web Speech",
  ],
} as const;
