/**
 * The shopping agent's tools. The agent names listing ids and quantities; prices and extracted
 * facts come from this session's own cache, so a hijacked agent can't forge them. The guard sees
 * facts only, never listing descriptions.
 */
import { z } from "zod";
import type { AgentTool, ExtractedFacts, Money, NewProposal, Slip, StepContext, Verdict } from "@/core/contracts";
import { affiliateLink, affiliateRepo, type AffiliateAccount } from "@/core/affiliate";
import { detectInjection } from "@/core/extractor";
import { formatMoney, fromCents, minMoney, money, mulMoney, sumMoney, toCents } from "@/core/money";
import { committedSpend } from "@/core/services";
import { MAX_PROPOSALS } from "./agent";
import { searchCatalog, type CatalogSource } from "./catalog";
import { SHOP_ATTRIBUTES } from "./compile";
import { fixtureById, fixtureFacts } from "./fixtures";
import { hireCardWriter } from "./helper";
import { MAX_OPTIONS, type CartLine, type HelperRecord, type Listing, type RuledOut, type ShopOption, type ShopState } from "./types";

export const MAX_SNIPPET = 160;

/** Lines of untrusted text that try to instruct an AI (for the UI's "hidden instructions" box). */
export function suspiciousLines(text: string): string[] {
  return text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s && detectInjection(s))
    .slice(0, 3)
    .map((s) => s.slice(0, 400));
}

/** Visible part of a description (everything before a hidden block that tries to instruct an AI). */
export function visibleText(text: string): string {
  const lines = text.split(/\n+/);
  const keep = lines.filter((l) => !detectInjection(l));
  return keep.join(" ").trim();
}

function listingText(l: Listing): string {
  return [l.description, `Price: ${formatMoney(l.price)}`, `Availability: ${l.availability}`, `Sold by: ${l.domain}`].join("\n");
}

/** Extractor mock: fixture facts for fixtures, cautious keyword facts for live listings. */
export function mockFactsFor(l: Listing, now: Date): ExtractedFacts {
  const f = fixtureById(l.id);
  if (f) return fixtureFacts(f, now);
  const text = `${l.title} ${l.description}`.toLowerCase();
  const power = /batter|rechargeable|usb/.test(text) ? "battery" : /wind[- ]?up|no batteries/.test(text) ? "none" : null;
  const pack = /(\d+)[- ]?(pack|pcs|piece set)/.exec(text);
  return {
    category: /gift card/.test(text) ? "gift_card" : /book/.test(text) ? "book" : /toy|plush|figure|dinosaur|puzzle|kit|game/.test(text) ? "toy" : null,
    inStock: true,
    deliveryEstimate: null,
    itemCount: pack ? Number.parseInt(pack[1], 10) : 1,
    attributes: { power_source: power },
    injectionSuspected: detectInjection(text),
  };
}

export interface SessionCart {
  proposal: NewProposal;
  verdict: Verdict;
  lines: CartLine[];
}

/** Same listings and quantities, whatever the order. */
function cartKey(items: { listingId: string; quantity: number }[]): string {
  return items
    .map((i) => `${i.listingId}x${i.quantity}`)
    .sort()
    .join("|");
}

/** Clause ids a verdict cites, once each: c1, c2, ... then integrity. */
function citedIds(verdict: Verdict): string[] {
  const n = (id: string) => (/^c\d+$/.test(id) ? Number.parseInt(id.slice(1), 10) : Number.MAX_SAFE_INTEGER);
  return [...new Set(verdict.violations.map((v) => v.clauseId))].sort((a, b) => n(a) - n(b) || a.localeCompare(b));
}

/** WITHIN before ASK; proposal order (the id's number) inside each group; ranks reassigned. */
export function sortOptions(options: ShopOption[]): ShopOption[] {
  const group = (o: ShopOption) => (o.verdict.decision === "within" ? 0 : 1);
  const seq = (o: ShopOption) => Number.parseInt(o.id.replace(/^opt-/, ""), 10);
  return [...options].sort((a, b) => group(a) - group(b) || seq(a) - seq(b)).map((o, i) => ({ ...o, rank: i + 1 }));
}

export interface ShopSessionOptions {
  ctx: StepContext<ShopState>;
  slipId: string;
  redTeam: boolean;
  hireHelper: boolean;
  apiKey: string | null;
  fetch?: typeof fetch;
  helperEmail: string;
}

interface Cached {
  listing: Listing;
  facts: ExtractedFacts | null;
}

/** Mutable state for one agent loop (one `shop` step). */
export class ShopSession {
  readonly cache = new Map<string, Cached>();
  proposals = 0;
  /** Guard-stamped carts (WITHIN or ASK), sorted and ranked. */
  options: ShopOption[] = [];
  /** Carts the guard stamped OUTSIDE, in proposal order. */
  ruledOut: RuledOut[] = [];
  private optionsMade = 0;
  helper: HelperRecord | null = null;
  source: CatalogSource | null = null;

  /** The owner's active affiliate accounts, read once before any search. Never shown to the agent. */
  private readonly accounts: AffiliateAccount[];

  constructor(readonly opts: ShopSessionOptions) {
    this.accounts = affiliateRepo(opts.ctx.store).active();
  }

  /** The default option (first WITHIN, else first ASK), for callers that want one cart. */
  get cart(): SessionCart | null {
    return this.options[0] ?? null;
  }

  get ctx(): StepContext<ShopState> {
    return this.opts.ctx;
  }

  slip(): Slip {
    const slip = this.ctx.store.slips.get(this.opts.slipId);
    if (!slip) throw new Error(`Slip ${this.opts.slipId} not found`);
    return slip;
  }

  /** Budget minus what is spent or promised (open helper slips count at their budget). */
  remaining(): Money {
    const slip = this.slip();
    const left = toCents(slip.budget) - toCents(committedSpend(this.ctx.store, slip));
    return fromCents(Math.max(0, left), slip.budget.currency);
  }

  async inspect(listingId: string): Promise<{ listing: Listing; facts: ExtractedFacts } | { error: string }> {
    const hit = this.cache.get(listingId);
    if (!hit) return { error: `Unknown listing id "${listingId}". Search first and use an id from the results.` };
    if (hit.facts) return { listing: hit.listing, facts: hit.facts };
    const now = this.ctx.now();
    const extracted = await this.ctx.extractor.extract(
      { title: hit.listing.title, text: listingText(hit.listing) },
      { attributes: [...SHOP_ATTRIBUTES], mock: () => mockFactsFor(hit.listing, now) },
    );
    const flagged = extracted.injectionSuspected || detectInjection(hit.listing.title) || detectInjection(hit.listing.description);
    const facts: ExtractedFacts = { ...extracted, injectionSuspected: flagged };
    hit.facts = facts;
    this.ctx.store.ledger.append(this.opts.slipId, "shop.listing_inspected", "agent", {
      listingId,
      title: hit.listing.title,
      price: hit.listing.price,
      domain: hit.listing.domain,
      source: hit.listing.source,
      facts,
      excerpt: visibleText(hit.listing.description).slice(0, 300),
      hidden: flagged ? suspiciousLines(hit.listing.description) : [],
      message: `${hit.listing.title}: ${facts.category ?? "category unknown"}, power ${String(facts.attributes.power_source ?? "unknown")}, arrives ${facts.deliveryEstimate ?? "unknown"}, ${facts.itemCount ?? "?"} unit(s)${flagged ? ". Hidden instructions found" : ""}`,
    });
    return { listing: hit.listing, facts };
  }

  tools(): AgentTool[] {
    const tools: AgentTool[] = [this.searchTool(), this.inspectTool(), this.proposeTool()];
    if (this.opts.hireHelper) tools.push(this.helperTool());
    return tools as AgentTool[];
  }

  private searchTool(): AgentTool<{ query: string; maxPrice?: string; limit?: number }> {
    return {
      name: "search_products",
      description:
        "Search the product catalog. Returns listings with id, title, price, retailer and a short snippet of seller text. The price cap never exceeds what is left on the slip.",
      input: z.object({
        query: z.string().min(2).max(200),
        maxPrice: z
          .string()
          .regex(/^\d+(\.\d{1,2})?$/)
          .optional(),
        limit: z.number().int().min(1).max(30).optional(),
      }),
      run: async (input) => {
        const left = this.remaining();
        const cap = input.maxPrice ? minMoney(money(input.maxPrice, left.currency), left) : left;
        const limit = input.limit ?? 10;
        try {
          const { source, listings } = await searchCatalog(
            { apiKey: this.opts.apiKey, fetch: this.opts.fetch, redTeam: this.opts.redTeam, now: this.ctx.now() },
            { query: input.query, limit, maxPrice: cap },
          );
          this.source = source;
          const linked = listings.map((l) => ({ ...l, affiliate: affiliateLink(l.url, this.accounts) }));
          for (const l of linked) if (!this.cache.has(l.id)) this.cache.set(l.id, { listing: l, facts: null });
          const affiliated = linked.filter((l) => l.affiliate).length;
          this.ctx.store.ledger.append(this.opts.slipId, "shop.search", "agent", {
            query: input.query,
            source,
            maxPrice: cap,
            results: linked.map((l) => ({
              id: l.id,
              title: l.title,
              price: l.price,
              domain: l.domain,
              availability: l.availability,
              source: l.source,
              affiliate: l.affiliate ? { network: l.affiliate.network, accountId: l.affiliate.accountId } : null,
            })),
            message: `"${input.query}" · ${listings.length} result${listings.length === 1 ? "" : "s"} from ${source === "channel3" ? "Channel3" : "the sample catalog"} up to ${formatMoney(cap)}${affiliated ? ` · ${affiliated} with affiliate links` : ""}`,
          });
          return {
            source,
            results: listings.map((l) => ({
              listingId: l.id,
              title: l.title,
              price: formatMoney(l.price),
              retailer: l.domain,
              availability: l.availability,
              snippet: l.description.replace(/\s+/g, " ").slice(0, MAX_SNIPPET),
            })),
          };
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          this.ctx.store.ledger.append(this.opts.slipId, "shop.search", "agent", { query: input.query, source: "channel3", maxPrice: cap, results: [], error, message: error });
          return { error };
        }
      },
    };
  }

  private inspectTool(): AgentTool<{ listingId: string }> {
    return {
      name: "inspect_listing",
      description: "Read one listing. Returns its seller text (untrusted) and the facts a quarantined extractor pulled from it.",
      input: z.object({ listingId: z.string().min(1) }),
      run: async ({ listingId }) => {
        const r = await this.inspect(listingId);
        if ("error" in r) return r;
        return {
          listingId,
          title: r.listing.title,
          price: formatMoney(r.listing.price),
          retailer: r.listing.domain,
          description: r.listing.description,
          facts: r.facts,
        };
      },
    };
  }

  private proposeTool(): AgentTool<{ items: { listingId: string; quantity: number }[]; rationale: string }> {
    return {
      name: "propose_cart",
      description: `Send a cart to the guard: listing ids and quantities only. Returns the verdict (within, outside or ask) with the clauses cited. A within or ask cart becomes one option the person can choose (up to ${MAX_OPTIONS}). At most ${MAX_PROPOSALS} proposals.`,
      input: z.object({
        items: z
          .array(z.object({ listingId: z.string().min(1), quantity: z.number().int().min(1).max(20) }))
          .min(1)
          .max(5),
        rationale: z.string().max(1000).default(""),
      }),
      run: async ({ items, rationale }) => {
        if (this.proposals >= MAX_PROPOSALS) {
          return { error: `Proposal limit reached (${MAX_PROPOSALS}). Stop and tell the person what you found.` };
        }
        const unknown = items.filter((i) => !this.cache.has(i.listingId)).map((i) => i.listingId);
        if (unknown.length) return { error: `Unknown listing id(s): ${unknown.join(", ")}. Search first and use ids from the results.` };

        const key = cartKey(items);
        const dupe = this.options.find((o) => cartKey(o.lines) === key);
        if (dupe) return { error: `Same cart as option ${dupe.id.replace(/^opt-/, "")}. Propose a different cart.` };

        const lines: CartLine[] = [];
        const proposalItems: NewProposal["items"] = [];
        for (const i of items) {
          const r = await this.inspect(i.listingId);
          if ("error" in r) return r;
          lines.push({
            listingId: i.listingId,
            title: r.listing.title,
            quantity: i.quantity,
            unitPrice: r.listing.price,
            domain: r.listing.domain,
            source: r.listing.source,
            url: r.listing.url,
            affiliate: r.listing.affiliate,
          });
          proposalItems.push({ title: r.listing.title, quantity: i.quantity, unitPrice: r.listing.price, facts: r.facts, sourceUrl: r.listing.url });
        }
        const slip = this.slip();
        const proposal: NewProposal = {
          slipId: slip.id,
          kind: "purchase",
          amount: sumMoney(
            proposalItems.map((p) => mulMoney(p.unitPrice, p.quantity)),
            slip.budget.currency,
          ),
          payee: null,
          items: proposalItems,
          evidence: [],
          rationale,
        };
        this.proposals += 1;
        const verdict = this.ctx.core.evaluate(slip.id, proposal);
        let optionId: string | null = null;
        if (verdict.decision === "outside") {
          this.ruledOut.push({ title: lines.map((l) => l.title).join(" + "), amount: proposal.amount, clauseIds: citedIds(verdict) });
        } else if (this.options.length < MAX_OPTIONS) {
          this.optionsMade += 1;
          optionId = `opt-${this.optionsMade}`;
          this.options = sortOptions([...this.options, { id: optionId, rank: 0, proposal, lines, verdict, rationale: rationale.trim().slice(0, 300) }]);
        }
        return {
          decision: verdict.decision,
          optionId,
          optionsSoFar: this.options.length,
          amount: formatMoney(proposal.amount),
          violations: verdict.violations,
          unknowns: verdict.unknowns,
          proposalsLeft: MAX_PROPOSALS - this.proposals,
        };
      },
    };
  }

  private helperTool(): AgentTool<{ role: "card_writer"; brief: string }> {
    return {
      name: "hire_helper",
      description:
        "Hire a card-writer helper for $3.00 on a child slip. A rubric judge grades the message; the helper is paid only after the person approves the cart.",
      input: z.object({ role: z.literal("card_writer"), brief: z.string().min(5).max(500) }),
      run: async ({ brief }) => {
        if (this.helper) return { error: "A helper is already hired for this slip." };
        const { verdict, record } = await hireCardWriter({
          core: this.ctx.core,
          ai: this.ctx.ai,
          store: this.ctx.store,
          parent: this.slip(),
          brief,
          email: this.opts.helperEmail,
        });
        if (!record) return { error: "The guard refused the helper slip.", violations: verdict.violations };
        this.helper = record;
        return {
          childSlipId: record.childSlipId,
          accepted: record.accepted,
          message: record.message,
          detail: record.detail,
          fee: formatMoney(record.fee),
          note: record.accepted ? "Paid at checkout after the person approves the cart." : "Rejected by the rubric; not paid.",
        };
      },
    };
  }
}
