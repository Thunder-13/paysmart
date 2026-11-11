/**
 * Discovery: PaySmart runs one search per need, screens every listing, opens the top few clean
 * ones through the quarantined extractor and stamps them against the slip. The agent never searches.
 */
import type { Slip, StepContext } from "@/core/contracts";
import { affiliateLink, affiliateRepo } from "@/core/affiliate";
import { formatMoney } from "@/core/money";
import { searchCatalog, type CatalogSource } from "@/pipelines/shop/catalog";
import type { Listing } from "@/pipelines/shop/types";
import { inspectProduct, listingRepo } from "./board";
import { searchPaysmartFixtures } from "./fixtures";
import { integrityScreen, isTrusted, sellerScreen, slipSkipped, statusOf } from "./screens";
import { INSPECT_PER_NEED, RESULTS_PER_SEARCH, type PaySmartState, type ProductCard, type SearchRun } from "./types";

type Ctx = StepContext<PaySmartState>;

export interface DiscoverDeps {
  apiKey: string | null;
  fetch?: typeof fetch;
}

export async function discoverNeed(ctx: Ctx, deps: DiscoverDeps, slip: Slip, index: number): Promise<Partial<PaySmartState>> {
  const s = ctx.run.state;
  const needs = s.route?.needs ?? [];
  const need = needs[index];
  if (!need) return { discoverCursor: needs.length };
  const now = ctx.now();
  const maxPrice = slip.budget;
  const repo = listingRepo(ctx.store, slip.id);

  let source: CatalogSource;
  let shop: Listing[];
  let fellBack: string | null = null;
  const req = { query: need.query, limit: RESULTS_PER_SEARCH, maxPrice };
  try {
    ({ source, listings: shop } = await searchCatalog({ apiKey: deps.apiKey, fetch: deps.fetch, redTeam: s.redTeam, now }, req));
  } catch (e) {
    fellBack = e instanceof Error ? e.message : String(e);
    ({ source, listings: shop } = await searchCatalog({ apiKey: null, redTeam: s.redTeam, now }, req));
  }
  const extra =
    source === "fixtures"
      ? searchPaysmartFixtures({ query: need.query, maxPrice: maxPrice.value, now })
      : s.redTeam
        ? searchPaysmartFixtures({ query: need.query, maxPrice: maxPrice.value, now, asPlanted: true })
        : [];
  const accounts = affiliateRepo(ctx.store).active();
  const seen = new Set<string>();
  const returned: Listing[] = [];
  for (const l of [...shop, ...extra]) {
    if (seen.has(l.id)) continue;
    seen.add(l.id);
    returned.push({ ...l, affiliate: affiliateLink(l.url, accounts) });
  }

  let products = [...s.products];
  const byId = () => new Map(products.map((p) => [p.listingId, p]));
  for (const l of returned) {
    if (byId().has(l.id)) continue;
    const screens = [integrityScreen(l), sellerScreen(l), slipSkipped()];
    const card: ProductCard = {
      listingId: l.id,
      need: need.need,
      title: l.title,
      price: l.price,
      domain: l.domain,
      url: l.url,
      source: l.source,
      affiliate: l.affiliate,
      facts: null,
      screens,
      status: statusOf(screens),
    };
    repo.put(l);
    products.push(card);
    const failed = screens.filter((x) => x.status === "fail");
    ctx.store.ledger.append(slip.id, "paysmart.listing_screened", "system", {
      listingId: l.id,
      title: l.title,
      need: need.need,
      screens,
      message: failed.length ? `${l.title}: dropped. ${failed.map((x) => x.reason).join("; ")}` : `${l.title}: passed the integrity and seller screens`,
    });
  }

  const eligible = returned.filter((l) => {
    const p = byId().get(l.id);
    return p ? isTrusted(p) : false;
  });
  for (const l of eligible.slice(0, INSPECT_PER_NEED)) {
    const p = byId().get(l.id);
    if (!p || p.facts) continue;
    const updated = await inspectProduct(ctx, slip, p, l, needs);
    products = products.map((x) => (x.listingId === l.id ? updated : x));
  }

  const after = byId();
  const ids = returned.map((l) => l.id);
  const cards = ids.map((id) => after.get(id)).filter((p): p is ProductCard => !!p);
  const ruledOut = cards.filter((p) => !isTrusted(p)).length;
  const shown = cards.length - ruledOut;
  const inspected = eligible.slice(0, INSPECT_PER_NEED).filter((l) => after.get(l.id)?.facts && isTrusted(after.get(l.id) as ProductCard)).length;
  const run: SearchRun = {
    id: `s-${s.searches.length + 1}`,
    need: need.need,
    query: need.query,
    source,
    maxPrice,
    at: now.toISOString(),
    found: returned.length,
    ruledOut,
    shown,
    inspected,
    listingIds: ids,
  };
  const where = source === "channel3" ? "Channel3" : "the sample catalog";
  ctx.store.ledger.append(slip.id, "paysmart.search", "system", {
    ...run,
    fellBack,
    message: `Searched ${where} for "${need.query}" (${need.need}), up to ${formatMoney(maxPrice)}: ${returned.length} found, ${ruledOut} dropped by screens, ${shown} shown, ${inspected} opened${fellBack ? `. Channel3 failed (${fellBack}), so the sample catalog answered` : ""}`,
  });
  return { products, searches: [...s.searches, run], discoverCursor: index + 1, catalogSource: source };
}
