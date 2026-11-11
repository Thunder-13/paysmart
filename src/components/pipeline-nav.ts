/** The pipeline destinations, PaySmart first as the front door, shared by the nav (client) and the footer (server). */
export const PIPELINE_NAV = [
  { href: "/p/paysmart", label: "PaySmart" },
  { href: "/p/shop", label: "Shop" },
  { href: "/p/second-look", label: "Second Look" },
  { href: "/p/bounty", label: "Bounty" },
  { href: "/p/cash-weather", label: "Cash Weather" },
  { href: "/p/toll-road", label: "Toll Road" },
  { href: "/p/dispute-desk", label: "Dispute Desk" },
] as const;
