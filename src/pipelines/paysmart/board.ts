/**
 * Shared board helpers: where full listings are kept between steps, how a product is opened
 * through the quarantined extractor, and how every product is re-stamped against the slip.
 * Listing descriptions are kept for the extractor only and never go to the guard. The guard
 * reads the item title in one fail-safe check (multi-pack pattern, can only raise ask).
 */
import type { Slip, Store, StepContext } from "@/core/contracts";
import { detectInjection } from "@/core/extractor";
import { formatMoney } from "@/core/money";
import { committedSpend } from "@/core/services";
import { SHOP_ATTRIBUTES } from "@/pipelines/shop/compile";
import { suspiciousLines, visibleText } from "@/pipelines/shop/tools";
import type { Listing } from "@/pipelines/shop/types";
import { paysmartFactsFor } from "./fixtures";
import { clip, integrityFromFacts, integrityScreen, slipScreen, statusOf, withScreen } from "./screens";
import type { Need, PaySmartState, ProductCard } from "./types";

type Ctx = StepContext<PaySmartState>;

export function listingRepo(store: Store, slipId: string) {
  const col = store.collection<Listing>("paysmart", "listings");
  return {
    put: (l: Listing) => col.put(`${slipId}:${l.id}`, l),
    get: (id: string) => col.get(`${slipId}:${id}`),
  };
}

export function listingText(l: Listing): string {
  return [l.description, `Price: ${formatMoney(l.price)}`, `Availability: ${l.availability}`, `Sold by: ${l.domain}`].join("\n");
}

export function quantityFor(needs: Need[], need: string | null): number {
  return needs.find((n) => n.need === need)?.quantity ?? 1;
}

/** Plain snippet of what the seller wrote, with any instruction-shaped lines cut out. Only for screened listings. */
export function snippetOf(l: Listing, max = 160): string {
  return clip(visibleText(l.description), max);
}

/**
 * Opens one product: quarantined extraction, then the integrity flip and the slip stamp.
 * Returns the updated card. Writes `paysmart.listing_inspected`.
 */
export async function inspectProduct(ctx: Ctx, slip: Slip, product: ProductCard, listing: Listing, needs: Need[]): Promise<ProductCard> {
  const now = ctx.now();
  const extracted = await ctx.extractor.extract(
    { title: listing.title, text: listingText(listing) },
    { attributes: [...SHOP_ATTRIBUTES], mock: () => paysmartFactsFor(listing, now) },
  );
  const flagged = extracted.injectionSuspected || detectInjection(listing.title) || detectInjection(listing.description);
  const facts = { ...extracted, injectionSuspected: flagged };
  let screens = product.screens;
  if (flagged) {
    const base = integrityFromFacts(facts);
    const line = suspiciousLines(listing.description)[0];
    if (base) screens = withScreen(screens, { ...base, quote: line ? clip(line) : null });
  } else {
    screens = withScreen(
      screens,
      slipScreen({
        slip,
        guard: ctx.guard,
        spent: committedSpend(ctx.store, slip),
        now,
        title: listing.title,
        price: listing.price,
        url: listing.url,
        quantity: quantityFor(needs, product.need),
        facts,
      }),
    );
  }
  ctx.store.ledger.append(slip.id, "paysmart.listing_inspected", "agent", {
    listingId: listing.id,
    title: listing.title,
    price: listing.price,
    domain: listing.domain,
    facts,
    screens,
    message: `${listing.title}: ${facts.category ?? "category unknown"}, power ${String(facts.attributes.power_source ?? "unknown")}, arrives ${facts.deliveryEstimate ?? "unknown"}${flagged ? ". Hidden instructions found, ruled out" : ""}`,
  });
  return { ...product, facts, screens, status: statusOf(screens) };
}

/** Fresh slip stamp for every product that has facts, against the slip as it is now. */
export function restampProducts(ctx: Ctx, slip: Slip, products: ProductCard[], needs: Need[]): ProductCard[] {
  const now = ctx.now();
  const spent = committedSpend(ctx.store, slip);
  return products.map((p) => {
    if (!p.facts) return p;
    if (p.screens.some((s) => (s.screen === "integrity" || s.screen === "seller") && s.status === "fail")) return p;
    const screens = withScreen(
      p.screens,
      slipScreen({ slip, guard: ctx.guard, spent, now, title: p.title, price: p.price, url: p.url, quantity: quantityFor(needs, p.need), facts: p.facts }),
    );
    return { ...p, screens, status: statusOf(screens) };
  });
}

export { integrityScreen };
