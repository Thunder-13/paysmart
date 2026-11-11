/**
 * PaySmart screens. Each one runs logic that already exists in another pipeline:
 *   integrity  Permission Slip: injection detection on listing text, plus the extractor's own flag
 *   seller     Second Look: scam-tactic detectors on listing text
 *   slip       Permission Slip guard (pure) on a one-line proposal built from facts only
 * Screens never throw and never pass listing text on to the guard.
 */
import type { ExtractedFacts, GuardFn, Money, Proposal, Slip } from "@/core/contracts";
import { detectInjection } from "@/core/extractor";
import { mulMoney } from "@/core/money";
import { DETECTOR_WEIGHTS, TACTIC_LABELS } from "@/pipelines/second-look/taxonomy";
import { detect } from "@/pipelines/second-look/detectors";
import { suspiciousLines } from "@/pipelines/shop/tools";
import type { Listing } from "@/pipelines/shop/types";
import type { Funnel, PaySmartOption, ProductCard, ProductStatus, ScreenResult } from "./types";

export const QUOTE_MAX = 160;

export function clip(text: string, max = QUOTE_MAX): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export function integrityScreen(l: Pick<Listing, "title" | "description">): ScreenResult {
  if (detectInjection(l.title) || detectInjection(l.description)) {
    const line = suspiciousLines(l.description)[0] ?? l.title;
    return { screen: "integrity", status: "fail", reason: "Hidden instructions to an AI", clauseIds: [], quote: clip(line) };
  }
  return { screen: "integrity", status: "pass", reason: "No hidden instructions in the listing text", clauseIds: [], quote: null };
}

export function integrityFromFacts(facts: ExtractedFacts): ScreenResult | null {
  if (!facts.injectionSuspected) return null;
  return { screen: "integrity", status: "fail", reason: "Hidden instructions to an AI", clauseIds: [], quote: null };
}

export function sellerScreen(l: Pick<Listing, "title" | "description">): ScreenResult {
  const findings = detect([{ source: "listing", text: `${l.title}\n${l.description}` }]);
  if (findings.length === 0) {
    return { screen: "seller", status: "pass", reason: "No scam tactics in the seller's text", clauseIds: [], quote: null };
  }
  const top = [...findings].sort((a, b) => (DETECTOR_WEIGHTS[b.id] ?? 0) - (DETECTOR_WEIGHTS[a.id] ?? 0))[0];
  return { screen: "seller", status: "fail", reason: findings.map((f) => TACTIC_LABELS[f.id]).join(", "), clauseIds: [], quote: clip(top.quote) };
}

export function slipSkipped(reason = "Not opened yet, so the slip was not checked"): ScreenResult {
  return { screen: "slip", status: "skipped", reason, clauseIds: [], quote: null };
}

/** Stamp one product against the slip with the pure guard. Facts only. */
export function slipScreen(args: {
  slip: Slip;
  guard: GuardFn;
  spent: Money;
  now: Date;
  title: string;
  price: Money;
  url: string | null;
  quantity: number;
  facts: ExtractedFacts;
}): ScreenResult {
  const now = args.now;
  const proposal: Proposal = {
    id: `board_${args.slip.id}`,
    createdAt: now.toISOString(),
    slipId: args.slip.id,
    kind: "purchase",
    amount: mulMoney(args.price, args.quantity),
    payee: null,
    items: [{ title: args.title, quantity: args.quantity, unitPrice: args.price, facts: args.facts, sourceUrl: args.url }],
    evidence: [],
    rationale: "",
  };
  const v = args.guard(args.slip, proposal, { spent: args.spent, now });
  if (v.decision === "outside") {
    return {
      screen: "slip",
      status: "fail",
      reason: v.violations
        .slice(0, 2)
        .map((x) => x.message)
        .join(" "),
      clauseIds: [...new Set(v.violations.map((x) => x.clauseId))],
      quote: null,
    };
  }
  if (v.decision === "ask") {
    return {
      screen: "slip",
      status: "ask",
      reason: v.unknowns
        .slice(0, 2)
        .map((x) => x.message)
        .join(" "),
      clauseIds: [...new Set(v.unknowns.map((x) => x.clauseId))],
      quote: null,
    };
  }
  return { screen: "slip", status: "pass", reason: "Fits every clause on your slip", clauseIds: [], quote: null };
}

/** Replace the screen with the same id, or append it. Keeps integrity, seller, slip order. */
export function withScreen(screens: ScreenResult[], next: ScreenResult): ScreenResult[] {
  const order = ["integrity", "seller", "slip"];
  const rest = screens.filter((s) => s.screen !== next.screen);
  return [...rest, next].sort((a, b) => order.indexOf(a.screen) - order.indexOf(b.screen));
}

function screenOf(p: Pick<ProductCard, "screens">, id: ScreenResult["screen"]): ScreenResult | undefined {
  return p.screens.find((s) => s.screen === id);
}

export function statusOf(screens: ScreenResult[]): ProductStatus {
  if (screens.some((s) => s.status === "fail")) return "ruled_out";
  const slip = screens.find((s) => s.screen === "slip");
  if (slip?.status === "ask") return "needs_you";
  if (slip?.status === "pass") return "eligible";
  return "unchecked";
}

/** Passed integrity and seller. The agent may open and propose these, whatever the slip screen says. */
export function isTrusted(p: Pick<ProductCard, "screens">): boolean {
  return screenOf(p, "integrity")?.status !== "fail" && screenOf(p, "seller")?.status !== "fail";
}

export function funnelOf(products: ProductCard[], options: PaySmartOption[]): Funnel {
  const clean = products.filter((p) => screenOf(p, "integrity")?.status !== "fail");
  const trusted = clean.filter((p) => screenOf(p, "seller")?.status !== "fail");
  const within = trusted.filter((p) => screenOf(p, "slip")?.status === "pass");
  const inCarts = new Set(options.flatMap((o) => o.lines.map((l) => l.listingId)));
  return { found: products.length, clean: clean.length, trusted: trusted.length, withinSlip: within.length, inCarts: inCarts.size };
}

/** The top reasons products were dropped, most common first, for the no-options note. */
export function topDropReasons(products: ProductCard[], n = 2): string[] {
  const counts = new Map<string, number>();
  for (const p of products) {
    for (const s of p.screens) {
      if (s.status !== "fail") continue;
      const label = s.screen === "slip" ? `broke your slip (${s.clauseIds.join(", ")})` : s.reason;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, c]) => `${label} (${c})`);
}
