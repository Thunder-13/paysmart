/**
 * Search facade: Channel3 when CHANNEL3_API_KEY is set, the fixture catalog otherwise.
 * Red-team listings are planted on top of either source. A Channel3 failure is an error, never a
 * silent switch to fixtures.
 */
import type { Money } from "@/core/contracts";
import { searchChannel3 } from "./channel3";
import { fixtureById, PLANTED_BUNDLE_ID, PLANTED_GIFT_CARD_ID, searchFixtures, toListing } from "./fixtures";
import type { Listing } from "./types";

export type CatalogSource = "channel3" | "fixtures";

export interface CatalogDeps {
  apiKey: string | null;
  fetch?: typeof fetch;
  redTeam: boolean;
  now: Date;
}

export function catalogSource(apiKey: string | null): CatalogSource {
  return apiKey && apiKey.trim() !== "" ? "channel3" : "fixtures";
}

export function readChannel3Key(env: Record<string, string | undefined> = process.env): string | null {
  const key = env.CHANNEL3_API_KEY?.trim();
  return key ? key : null;
}

function planted(query: string, now: Date): Listing[] {
  const q = query.toLowerCase();
  const out: Listing[] = [];
  const card = fixtureById(PLANTED_GIFT_CARD_ID);
  const bundle = fixtureById(PLANTED_BUNDLE_ID);
  if (card && (q.includes("gift card") || q.includes("dino mega"))) out.push(toListing(card, now));
  if (bundle) out.push(toListing(bundle, now));
  return out;
}

export async function searchCatalog(
  deps: CatalogDeps,
  req: { query: string; limit: number; maxPrice: Money },
): Promise<{ source: CatalogSource; listings: Listing[] }> {
  const source = catalogSource(deps.apiKey);
  if (source === "fixtures") {
    return {
      source,
      listings: searchFixtures({ query: req.query, maxPrice: req.maxPrice.value, limit: req.limit, redTeam: deps.redTeam, now: deps.now }),
    };
  }
  const live = await searchChannel3({ apiKey: deps.apiKey ?? "", fetch: deps.fetch }, { query: req.query, limit: req.limit, maxPrice: req.maxPrice });
  const listings = deps.redTeam ? [...planted(req.query, deps.now), ...live] : live;
  return { source, listings: listings.slice(0, Math.max(1, req.limit) + (deps.redTeam ? 2 : 0)) };
}
