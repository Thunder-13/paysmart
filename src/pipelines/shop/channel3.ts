/**
 * Channel3 product search client. POST https://api.trychannel3.com/v1/search with x-api-key.
 * Maps products[].offers[] to Listings (cheapest in-stock USD offer per product). Images dropped.
 */
import { z } from "zod";
import type { Money } from "@/core/contracts";
import { cmpMoney, money, toCents } from "@/core/money";
import type { Listing } from "./types";

export const CHANNEL3_URL = "https://api.trychannel3.com/v1/search";
export const CHANNEL3_MAX_LIMIT = 30;
export const CHANNEL3_DEFAULT_LIMIT = 10;

export class Channel3Error extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "Channel3Error";
    this.status = status;
  }
}

const NumLike = z.union([z.number(), z.string()]).nullish();

const OfferSchema = z.object({
  url: z.string().nullish(),
  domain: z.string().nullish(),
  price: z
    .object({
      price: NumLike,
      compare_at_price: NumLike,
      currency: z.string().nullish(),
    })
    .nullish(),
  availability: z.string().nullish(),
});

const ProductSchema = z.object({
  id: z.union([z.string(), z.number()]).nullish(),
  title: z.string().nullish(),
  description: z.string().nullish(),
  offers: z.array(OfferSchema).nullish(),
});

const ResponseSchema = z.union([z.object({ products: z.array(ProductSchema).nullish() }), z.array(ProductSchema)]);

export interface Channel3Request {
  query: string;
  limit?: number;
  /** Price cap in dollars (the slip's remaining budget). */
  maxPrice?: Money | null;
}

export interface Channel3Options {
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function clampLimit(limit: number | undefined): number {
  const n = Math.floor(limit ?? CHANNEL3_DEFAULT_LIMIT);
  return Math.min(CHANNEL3_MAX_LIMIT, Math.max(1, Number.isFinite(n) ? n : CHANNEL3_DEFAULT_LIMIT));
}

export function channel3Body(req: Channel3Request): Record<string, unknown> {
  const filters: Record<string, unknown> = { availability: ["InStock"] };
  // Documented shape: filters.price = { min_price, max_price } in dollars (https://api.trychannel3.com/openapi.json, SearchFilterPrice).
  if (req.maxPrice) filters.price = { max_price: toCents(req.maxPrice) / 100 };
  return { query: req.query, limit: clampLimit(req.limit), filters, config: { mode: "agentic" } };
}

/** Short stable hash (FNV-1a, 32 bit) for ids built from URLs. */
export function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function toMoney(v: number | string | null | undefined, currency: string): Money | null {
  if (v === null || v === undefined || v === "") return null;
  try {
    return money(v, currency);
  } catch {
    return null;
  }
}

function inStock(availability: string | null | undefined): boolean {
  return (availability ?? "").replace(/[\s_-]/g, "").toLowerCase() === "instock";
}

function domainOf(url: string | null | undefined): string {
  if (!url) return "unknown";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

export function mapChannel3Response(json: unknown): Listing[] {
  const parsed = ResponseSchema.safeParse(json);
  if (!parsed.success) throw new Channel3Error("Channel3 returned a response this app can't read.");
  const products = Array.isArray(parsed.data) ? parsed.data : (parsed.data.products ?? []);
  const out: Listing[] = [];
  for (const p of products) {
    const offers = (p.offers ?? [])
      .filter((o) => inStock(o.availability) && (o.price?.currency ?? "USD").toUpperCase() === "USD")
      .map((o) => ({ o, price: toMoney(o.price?.price, "USD") }))
      .filter((x): x is { o: (typeof x)["o"]; price: Money } => x.price !== null)
      .sort((a, b) => cmpMoney(a.price, b.price));
    const best = offers[0];
    if (!best || !p.title) continue;
    const url = best.o.url ?? null;
    const id = p.id !== null && p.id !== undefined && String(p.id) !== "" ? `c3-${String(p.id)}` : `c3-${shortHash(url ?? p.title)}`;
    out.push({
      id,
      title: p.title,
      description: p.description ?? "",
      price: best.price,
      compareAtPrice: toMoney(best.o.price?.compare_at_price, "USD"),
      domain: best.o.domain ?? domainOf(url),
      url,
      affiliate: null,
      availability: "InStock",
      source: "channel3",
    });
  }
  return out;
}

export async function searchChannel3(opts: Channel3Options, req: Channel3Request): Promise<Listing[]> {
  const doFetch = opts.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  let res: Response;
  try {
    res = await doFetch(CHANNEL3_URL, {
      method: "POST",
      headers: { "x-api-key": opts.apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(channel3Body(req)),
      signal: controller.signal,
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    throw new Channel3Error(aborted ? "Channel3 search timed out." : `Channel3 search failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Channel3Error(`Channel3 search failed: HTTP ${res.status}${text ? ` ${text.slice(0, 200)}` : ""}`, res.status);
  }
  const json = (await res.json().catch(() => null)) as unknown;
  const listings = mapChannel3Response(json);
  // The cap is enforced here too: the slip's budget never depends on a third party honoring a filter.
  const cap = req.maxPrice;
  return cap ? listings.filter((l) => cmpMoney(l.price, cap) <= 0) : listings;
}
