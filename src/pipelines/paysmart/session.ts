/**
 * The assemble agent's tools. The agent names listing ids and quantities. Prices and extracted
 * facts come from the board, so a hijacked agent cannot forge them. It has no search tool.
 * The guard sees facts only, never listing text.
 */
import { z } from "zod";
import type { AgentTool, NewProposal, Slip, StepContext, Verdict } from "@/core/contracts";
import { formatMoney, mulMoney, sumMoney, toCents } from "@/core/money";
import { sortOptions } from "@/pipelines/shop/tools";
import type { CartLine, RuledOut } from "@/pipelines/shop/types";
import { inspectProduct, listingRepo } from "./board";
import { isTrusted } from "./screens";
import { MAX_OPTIONS, type Need, type PaySmartOption, type PaySmartState, type ProductCard } from "./types";

export const MAX_PROPOSALS = 8;

function cartKey(items: { listingId: string; quantity: number }[]): string {
  return items
    .map((i) => `${i.listingId}x${i.quantity}`)
    .sort()
    .join("|");
}

export function citedIds(verdict: Verdict): string[] {
  const n = (id: string) => (/^c\d+$/.test(id) ? Number.parseInt(id.slice(1), 10) : Number.MAX_SAFE_INTEGER);
  return [...new Set(verdict.violations.map((v) => v.clauseId))].sort((a, b) => n(a) - n(b) || a.localeCompare(b));
}

export interface AssembleOptions {
  ctx: StepContext<PaySmartState>;
  slip: Slip;
  products: ProductCard[];
  needs: Need[];
}

/** Mutable state for one assemble step. */
export class AssembleSession {
  products: ProductCard[];
  proposals = 0;
  options: PaySmartOption[] = [];
  ruledOut: RuledOut[] = [];
  private made = 0;
  private readonly seen = new Set<string>();

  constructor(readonly opts: AssembleOptions) {
    this.products = [...opts.products];
  }

  private get ctx() {
    return this.opts.ctx;
  }

  private find(id: string): ProductCard | undefined {
    return this.products.find((p) => p.listingId === id);
  }

  private refusal(p: ProductCard | undefined, id: string): string | null {
    if (!p) return `Unknown listing id "${id}". Use an id from your task text.`;
    if (!isTrusted(p)) return `Listing "${id}" was ruled out by a screen and can't be opened or put in a cart.`;
    return null;
  }

  tools(): AgentTool[] {
    return [this.inspectTool(), this.proposeTool()] as AgentTool[];
  }

  private async open(id: string): Promise<{ product: ProductCard } | { error: string }> {
    const p = this.find(id);
    const bad = this.refusal(p, id);
    if (bad || !p) return { error: bad ?? "Unknown listing." };
    if (p.facts) return { product: p };
    const listing = listingRepo(this.ctx.store, this.opts.slip.id).get(id);
    if (!listing) return { error: `Listing "${id}" can't be read.` };
    const updated = await inspectProduct(this.ctx, this.opts.slip, p, listing, this.opts.needs);
    this.products = this.products.map((x) => (x.listingId === id ? updated : x));
    if (!isTrusted(updated)) return { error: `Listing "${id}" was ruled out by a screen and can't be opened or put in a cart.` };
    return { product: updated };
  }

  private inspectTool(): AgentTool<{ listingId: string }> {
    return {
      name: "inspect_listing",
      description: "Open one eligible listing that was not opened yet. Returns the facts a quarantined extractor pulled from it and the slip stamp. Listings already opened already show their facts in your task text.",
      input: z.object({ listingId: z.string().min(1) }),
      run: async ({ listingId }) => {
        const r = await this.open(listingId);
        if ("error" in r) return r;
        const p = r.product;
        const slip = p.screens.find((s) => s.screen === "slip");
        return { listingId, title: p.title, price: formatMoney(p.price), retailer: p.domain, facts: p.facts, slipStamp: slip ? `${slip.status}: ${slip.reason}` : "skipped" };
      },
    };
  }

  private proposeTool(): AgentTool<{ items: { listingId: string; quantity: number }[]; rationale: string }> {
    return {
      name: "propose_cart",
      description: `Send a cart to the guard: listing ids and quantities only, from listings that were opened. Returns the stamp (within, outside or ask) with the clauses cited. A within or ask cart becomes one option the person can choose (up to ${MAX_OPTIONS}). At most ${MAX_PROPOSALS} proposals.`,
      input: z.object({
        items: z
          .array(z.object({ listingId: z.string().min(1), quantity: z.number().int().min(1).max(20) }))
          .min(1)
          .max(5),
        rationale: z.string().max(1000).default(""),
      }),
      run: async ({ items, rationale }) => {
        if (this.proposals >= MAX_PROPOSALS) return { error: `Proposal limit reached (${MAX_PROPOSALS}). Stop and summarize.` };
        if (this.options.length >= MAX_OPTIONS) return { error: `You already have ${MAX_OPTIONS} options. Stop and summarize.` };
        const key = cartKey(items);
        if (this.seen.has(key)) return { error: "That cart was already proposed. Propose a different one." };

        for (const i of items) {
          const p = this.find(i.listingId);
          const bad = this.refusal(p, i.listingId);
          if (bad) return { error: bad };
          if (!p?.facts) return { error: `Listing "${i.listingId}" was not opened yet. Call inspect_listing first.` };
        }
        const lines: CartLine[] = [];
        const proposalItems: NewProposal["items"] = [];
        for (const i of items) {
          const p = this.find(i.listingId) as ProductCard & { facts: NonNullable<ProductCard["facts"]> };
          lines.push({ listingId: p.listingId, title: p.title, quantity: i.quantity, unitPrice: p.price, domain: p.domain, source: p.source, url: p.url, affiliate: p.affiliate });
          proposalItems.push({ title: p.title, quantity: i.quantity, unitPrice: p.price, facts: p.facts, sourceUrl: p.url });
        }
        const slip = this.ctx.store.slips.get(this.opts.slip.id) ?? this.opts.slip;
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
        this.seen.add(key);
        const verdict = this.ctx.core.evaluate(slip.id, proposal);
        let optionId: string | null = null;
        if (verdict.decision === "outside") {
          this.ruledOut.push({ title: lines.map((l) => l.title).join(" + "), amount: proposal.amount, clauseIds: citedIds(verdict) });
        } else {
          this.made += 1;
          optionId = `opt-${this.made}`;
          this.options = sortOptions([...this.options, { id: optionId, rank: 0, proposal, lines, verdict, rationale: rationale.trim().slice(0, 300) }]);
        }
        const stamp =
          verdict.decision === "within"
            ? `Within your slip: ${formatMoney(proposal.amount)}. It is now option ${optionId?.replace(/^opt-/, "")}.`
            : verdict.decision === "ask"
              ? `The guard needs the person to confirm a fact: ${verdict.unknowns.map((u) => u.message).join(" ")}`
              : `Outside your slip (${citedIds(verdict).join(", ")}): ${verdict.violations.map((v) => v.message).join(" ")}`;
        return {
          decision: verdict.decision,
          optionId,
          optionsSoFar: this.options.length,
          amount: formatMoney(proposal.amount),
          stamp,
          violations: verdict.violations,
          unknowns: verdict.unknowns,
          proposalsLeft: MAX_PROPOSALS - this.proposals,
        };
      },
    };
  }
}

export function cartTotalCents(o: PaySmartOption): number {
  return toCents(o.proposal.amount);
}
