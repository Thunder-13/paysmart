/**
 * Pure view logic for the PaySmart page: labels, grouping, filters, receipt rows and the exact
 * signals each button sends. No React, no browser, so view.test.ts runs in plain node.
 */
import type { Clause, LedgerEvent, Money, Run } from "@/core/contracts";
import { formatMoney, money } from "@/core/money";
import type { Attestation, ListingSource } from "@/pipelines/shop/types";
import {
  PAYSMART_DEMO_ASK,
  SCREEN_SOURCES,
  type Funnel,
  type PaySmartOption,
  type PaySmartOutcome,
  type PaySmartRuledOut,
  type PaySmartStage,
  type PaySmartTotals,
  type ProductCard,
  type ProductStatus,
  type ScreenResult,
  type ScreenStatus,
  type SearchRun,
} from "@/pipelines/paysmart/types";
import { describeEvent } from "@/components/event-text";

export const MAX_ASK = 600;

/** The ask a fresh page opens with: ?ask= when present (clipped), else the demo ask. */
export function initialAsk(param: string | string[] | undefined): string {
  const raw = typeof param === "string" ? param.trim() : "";
  return raw ? raw.slice(0, MAX_ASK) : PAYSMART_DEMO_ASK;
}

/* ------------------------------------------------------------ wait data */

const STAGES: readonly PaySmartStage[] = ["clarify", "choose", "sign", "delivery", "refund"];

export function waitData(run: Run | null): Record<string, unknown> {
  const d = run?.wait?.data;
  return d && typeof d === "object" ? (d as Record<string, unknown>) : {};
}

/** wait.data.stage when the run is waiting and the stage is one the page knows. */
export function waitStage(run: Run | null): PaySmartStage | null {
  if (!run || run.status !== "waiting" || !run.wait) return null;
  const s = waitData(run).stage;
  return typeof s === "string" && (STAGES as readonly string[]).includes(s) ? (s as PaySmartStage) : null;
}

function isMoney(v: unknown): v is Money {
  return !!v && typeof v === "object" && typeof (v as Money).value === "string" && typeof (v as Money).currency === "string";
}

export interface ChooseData {
  options: PaySmartOption[];
  ruledOut: PaySmartRuledOut[];
  funnel: Funnel | null;
  clauses: Clause[] | null;
  limit: Money | null;
  problem: string | null;
}

/** The choose wait's data, defensively read: anything missing becomes empty. */
export function chooseData(d: Record<string, unknown>): ChooseData {
  return {
    options: Array.isArray(d.options) ? (d.options as PaySmartOption[]) : [],
    ruledOut: Array.isArray(d.ruledOut) ? (d.ruledOut as PaySmartRuledOut[]) : [],
    funnel: d.funnel && typeof d.funnel === "object" ? (d.funnel as Funnel) : null,
    clauses: Array.isArray(d.clauses) ? (d.clauses as Clause[]) : null,
    limit: isMoney(d.limit) ? d.limit : null,
    problem: typeof d.problem === "string" && d.problem ? d.problem : null,
  };
}

export function signAmount(d: Record<string, unknown>, fallback: Money | null): Money | null {
  return isMoney(d.amount) ? d.amount : fallback;
}

/* --------------------------------------------------------------- labels */

export const OUTCOME_WORDS: Record<PaySmartOutcome, string> = {
  paid: "Paid. PayPal captured the cart you chose and released the rest of the hold.",
  refunded: "Refunded. The delivery broke the slip, so the money came back.",
  cancelled: "Cancelled. Nothing was charged.",
  no_options: "No cart fit your slip. Nothing was held and nothing was charged.",
  blocked: "Stopped by the guard. Nothing was charged.",
  capture_failed: "PayPal refused the capture. The hold was released and nothing was charged.",
  handed_off: "This ask belongs to another pipeline. Nothing was held and nothing was charged.",
};

export type OutcomeTone = "good" | "neutral" | "bad";

export const OUTCOME_TONE: Record<PaySmartOutcome, OutcomeTone> = {
  paid: "good",
  refunded: "good",
  cancelled: "neutral",
  no_options: "neutral",
  blocked: "bad",
  capture_failed: "bad",
  handed_off: "neutral",
};

export function outcomeLine(outcome: PaySmartOutcome, note: string | null): string {
  const base = OUTCOME_WORDS[outcome] ?? String(outcome);
  return note ? `${base} ${note}` : base;
}

export const STATUS_WORDS: Record<ProductStatus, string> = {
  eligible: "Eligible",
  ruled_out: "Ruled out",
  needs_you: "Needs you",
  unchecked: "Not inspected",
};

export const SCREEN_STATUS_WORDS: Record<ScreenStatus, string> = {
  pass: "pass",
  fail: "fail",
  ask: "needs you",
  skipped: "skipped",
};

export interface ScreenRow {
  /** From SCREEN_SOURCES, e.g. "Second Look: scam tactics in seller text". */
  source: string;
  status: ScreenStatus;
  statusWord: string;
  reason: string;
  quote: string | null;
  clauseIds: string[];
}

/** Strip em and en dashes from engine text so no dash glyph reaches the page. */
export function plain(text: string): string {
  return text.replace(/\s*[–—]\s*/g, ", ");
}

export function screenRow(r: ScreenResult): ScreenRow {
  return {
    source: SCREEN_SOURCES[r.screen]?.label ?? r.screen,
    status: r.status,
    statusWord: SCREEN_STATUS_WORDS[r.status] ?? r.status,
    reason: plain(r.reason),
    quote: r.quote,
    clauseIds: r.clauseIds ?? [],
  };
}

/** One line of text for a screen result, for screen readers and tests. */
export function screenText(r: ScreenResult): string {
  const row = screenRow(r);
  return `${row.source}. ${row.statusWord}: ${row.reason}${row.quote ? ` Quote: "${row.quote}"` : ""}`;
}

/* ---------------------------------------------------------------- board */

export const FILTERS = ["all", "eligible", "ruled_out", "needs_you"] as const;
export type BoardFilter = (typeof FILTERS)[number];

export const FILTER_WORDS: Record<BoardFilter, string> = {
  all: "All",
  eligible: "Eligible",
  ruled_out: "Ruled out",
  needs_you: "Needs you",
};

export function filterProducts(products: ProductCard[], filter: BoardFilter): ProductCard[] {
  return filter === "all" ? products : products.filter((p) => p.status === filter);
}

export function filterCounts(products: ProductCard[]): Record<BoardFilter, number> {
  const counts: Record<BoardFilter, number> = { all: products.length, eligible: 0, ruled_out: 0, needs_you: 0 };
  for (const p of products) {
    if (p.status === "eligible" || p.status === "ruled_out" || p.status === "needs_you") counts[p.status] += 1;
  }
  return counts;
}

export interface FunnelStep {
  key: keyof Funnel;
  label: string;
  value: number;
}

export function funnelSteps(f: Funnel): FunnelStep[] {
  return [
    { key: "found", label: "Found", value: f.found },
    { key: "clean", label: "Clean", value: f.clean },
    { key: "trusted", label: "Trusted sellers", value: f.trusted },
    { key: "withinSlip", label: "Within your slip", value: f.withinSlip },
    { key: "inCarts", label: "In carts", value: f.inCarts },
  ];
}

/* ----------------------------------------------------------- discovery */

export function sourceName(source: SearchRun["source"]): string {
  return source === "channel3" ? "Channel3" : "offline catalog";
}

/** "12 found · 2 dropped by screens · 10 shown · 5 checked against your slip" */
export function countsLine(r: Pick<SearchRun, "found" | "ruledOut" | "shown" | "inspected">): string {
  return `${r.found} found · ${r.ruledOut} dropped by screens · ${r.shown} shown · ${r.inspected} checked against your slip`;
}

export function pendingLine(need: string): string {
  return `Searching for ${need}…`;
}

export interface Lane {
  key: string;
  need: string;
  /** Null for a pending lane (needs not yet searched) and for the catch-all lane. */
  search: SearchRun | null;
  pending: boolean;
  /** Products passing the active filter, ordered by the search's listingIds. */
  products: ProductCard[];
  /** Ruled-out products, collapsed under "Dropped (n)". Empty when the filter hides them. */
  dropped: ProductCard[];
  droppedOpen: boolean;
}

/**
 * One lane per SearchRun, in run order; each product goes to the first search whose need matches
 * its need, ordered by that search's listingIds. Needs with no search yet get a pending lane.
 * Products with no matching search land in a final "Other listings" lane. The filter applies
 * inside each lane: Ruled out shows only the dropped list (open), Eligible and Needs you hide it.
 */
export function buildLanes(needs: string[], searches: SearchRun[], products: ProductCard[], filter: BoardFilter): Lane[] {
  const claimed = new Set<string>();
  const lanes: Lane[] = [];
  const split = (key: string, need: string, search: SearchRun | null, mine: ProductCard[]): Lane => {
    const dropped = mine.filter((p) => p.status === "ruled_out");
    const live = mine.filter((p) => p.status !== "ruled_out");
    const showDropped = filter === "all" || filter === "ruled_out";
    return {
      key,
      need,
      search,
      pending: false,
      products: filter === "ruled_out" ? [] : filterProducts(live, filter),
      dropped: showDropped ? dropped : [],
      droppedOpen: filter === "ruled_out",
    };
  };
  for (const s of searches) {
    const mine = products.filter((p) => !claimed.has(p.listingId) && p.need === s.need);
    const rank = (p: ProductCard) => {
      const i = s.listingIds.indexOf(p.listingId);
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    mine.sort((a, b) => rank(a) - rank(b));
    for (const p of mine) claimed.add(p.listingId);
    lanes.push(split(s.id, s.need, s, mine));
  }
  const searched = new Set(searches.map((s) => s.need));
  for (const n of needs) {
    if (searched.has(n)) continue;
    lanes.push({ key: `pending-${n}`, need: n, search: null, pending: true, products: [], dropped: [], droppedOpen: false });
  }
  const rest = products.filter((p) => !claimed.has(p.listingId));
  if (rest.length) lanes.push(split("other", "Other listings", null, rest));
  return lanes;
}

/** How the ask arrived: "voice" only when the box still holds exactly what was dictated. */
export function askViaFor(dictated: string | null, current: string): "typed" | "voice" {
  return dictated !== null && dictated.trim() !== "" && current.trim() === dictated.trim() ? "voice" : "typed";
}

export function activityHeading(step: string | undefined): string {
  return step === "assemble" ? "The agent is building carts from these products" : "Agent activity";
}

export interface SourceTag {
  label: string;
  tone: "red" | "muted";
}

/** Planted listings are the red-team plants; fixture marketplace sellers get their own tag. */
export function sourceTag(source: ListingSource, domain: string): SourceTag | null {
  if (source === "planted") return { label: "Planted", tone: "red" };
  if (source === "fixture") {
    return /marketplace/i.test(domain) ? { label: "Marketplace seller (sample)", tone: "muted" } : { label: "Sample data", tone: "muted" };
  }
  return null;
}

function webUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export interface RetailerLink {
  /** Null for sample and planted listings: their URL is shown as text, not linked. */
  href: string | null;
  text: string | null;
  /** "sponsored noopener noreferrer" when an affiliate link is used, else "noopener noreferrer". */
  rel: string;
  affiliate: boolean;
}

export function retailerLink(p: Pick<ProductCard, "url" | "affiliate" | "source">): RetailerLink | null {
  const url = webUrl(p.affiliate?.url ?? p.url);
  if (!url) return null;
  const affiliate = !!p.affiliate;
  const rel = affiliate ? "sponsored noopener noreferrer" : "noopener noreferrer";
  return p.source === "channel3" ? { href: url, text: null, rel, affiliate } : { href: null, text: url, rel, affiliate };
}

export function anyAffiliate(items: { affiliate: unknown }[]): boolean {
  return items.some((i) => !!i.affiliate);
}

/* -------------------------------------------------------------- options */

export function optionTitle(o: PaySmartOption): string {
  return o.lines.map((l) => (l.quantity > 1 ? `${l.quantity} × ${l.title}` : l.title)).join(" + ");
}

export function payLabel(total: Money): string {
  return `Pay ${formatMoney(total)} with PayPal`;
}

export function holdLine(amount: Money): string {
  return `PayPal will hold ${formatMoney(amount)}, the cart you chose, not your full limit.`;
}

/** Attestation fields a chosen ASK cart still needs, once each. */
export function unknownFields(o: PaySmartOption | undefined): string[] {
  return [...new Set((o?.verdict.unknowns ?? []).map((u) => u.field))];
}

export const FIELD_WORDS: Record<string, string> = {
  deliveryEstimate: "Delivery date",
  inStock: "In stock",
  category: "Category",
  itemCount: "Units per listing",
};

export function fieldLabel(field: string): string {
  return FIELD_WORDS[field] ?? field.replace(/^attributes\./, "").replace(/_/g, " ");
}

/** Typed answers to attestations, skipping blanks. Same coercions as Shop. */
export function buildAttestations(fields: string[], answers: Record<string, string>): Attestation[] {
  return fields
    .filter((f) => (answers[f] ?? "") !== "")
    .map((f) => {
      const raw = answers[f];
      const value = f === "itemCount" ? Number.parseInt(raw, 10) : f === "inStock" ? raw === "yes" : raw;
      return { field: f, value };
    });
}

/* ---------------------------------------------------------- clause edit */

export const REMOVABLE_KINDS: ReadonlySet<Clause["kind"]> = new Set(["quantity_max", "category_in", "deliver_by", "exclude_attribute"]);

export type ClauseEdit = { ok: true; clauses: Clause[] } | { ok: false; error: string };

/** New budget and dropped clause ids applied to the compiled clauses. */
export function editClauses(clauses: Clause[], budget: string, dropped: string[]): ClauseEdit {
  let amount: Money;
  try {
    amount = money(budget || "0");
  } catch {
    return { ok: false, error: "Type the spending limit as a number, like 60 or 42.50." };
  }
  const edited = clauses.filter((c) => !dropped.includes(c.id) || !REMOVABLE_KINDS.has(c.kind)).map((c) => (c.kind === "budget_max" ? { ...c, amount } : c));
  return { ok: true, clauses: edited };
}

export function clausesChanged(before: Clause[], after: Clause[]): boolean {
  return JSON.stringify(before) !== JSON.stringify(after);
}

export function budgetOf(clauses: Clause[]): string {
  const c = clauses.find((x): x is Extract<Clause, { kind: "budget_max" }> => x.kind === "budget_max");
  return c && c.amount.value !== "0.00" ? c.amount.value : "";
}

/* -------------------------------------------------------------- signals */

type Via = "click" | "keyboard" | "voice";

export const signals = {
  /** ClarifySignalSchema: null when the answer is blank. */
  clarifyAnswer(text: string): { answer: string } | null {
    const answer = text.trim().slice(0, 300);
    return answer ? { answer } : null;
  },
  clarifyCancel(): { cancel: true } {
    return { cancel: true };
  },
  /** ChooseSignalSchema: approve one cart. */
  choose(optionId: string, via: Via, attestations: Attestation[]): { approved: true; optionId: string; via: Via; attestations?: Attestation[] } {
    return { approved: true, optionId, via, ...(attestations.length ? { attestations } : {}) };
  },
  decline(): { approved: false } {
    return { approved: false };
  },
  /** Edited clauses with no optionId: the pipeline re-stamps and waits again, nothing is paid. */
  recheck(clauses: Clause[]): { approved: true; clauses: Clause[] } {
    return { approved: true, clauses };
  },
  deliveryPhoto(f: { ref: string; contentType: string }): { ref: string; contentType: string } {
    return { ref: f.ref, contentType: f.contentType };
  },
  deliverySample(): { sample: true } {
    return { sample: true };
  },
  deliverySkip(): { skip: true } {
    return { skip: true };
  },
  refund(approved: boolean): { approved: boolean } {
    return { approved };
  },
};

/* -------------------------------------------------------------- receipt */

export interface ReceiptRow {
  key: keyof PaySmartTotals;
  label: string;
  money: Money;
  tone: "neutral" | "green" | "amber" | "muted";
}

export function receiptRows(t: PaySmartTotals): ReceiptRow[] {
  return [
    { key: "limit", label: "Your limit", money: t.limit, tone: "neutral" },
    { key: "held", label: "PayPal held", money: t.held, tone: "amber" },
    { key: "captured", label: "Captured", money: t.captured, tone: "neutral" },
    { key: "released", label: "Released", money: t.released, tone: "green" },
    { key: "refunded", label: "Refunded", money: t.refunded, tone: "muted" },
  ];
}

export const DISPUTE_READY = "Dispute-ready: Dispute Desk can answer a dispute on this payment from its chained evidence.";

export function evidenceHref(slipId: string): string {
  return `/api/slips/${encodeURIComponent(slipId)}/evidence`;
}

/* ------------------------------------------------------------- activity */

export interface ActivityLine {
  key: string;
  actor: LedgerEvent["actor"];
  title: string;
  detail: string | null;
}

const QUIET_TYPES = new Set(["run.step", "run.waiting", "run.done", "slip.created"]);

const SCREENED_TYPE = "paysmart.listing_screened";

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

/** The need a listing was screened for, when it passed every screen. Failed listings and listings with no need stay their own lines. */
export function passedScreenNeed(e: Pick<LedgerEvent, "type" | "data">): string | null {
  if (e.type !== SCREENED_TYPE) return null;
  const d = asRecord(e.data);
  const need = typeof d.need === "string" ? d.need.trim() : "";
  if (!need) return null;
  const screens = Array.isArray(d.screens) ? d.screens : [];
  return screens.some((s) => asRecord(s).status === "fail") ? null : need;
}

/** "dinosaur gift: 8 listings passed the screens" */
export function screenedGroupTitle(need: string, count: number): string {
  return `${need}: ${count} ${count === 1 ? "listing" : "listings"} passed the screens`;
}

/**
 * Plain-words lines from the run slip's ledger events, newest last, run bookkeeping left out.
 * Listings that passed the integrity and seller screens collapse to one line per need, placed where
 * that need's first listing was screened. Search events, drops, agent steps and payment events keep their own lines.
 */
export function activityLines(events: LedgerEvent[], limit = 40): ActivityLine[] {
  const passed = new Map<string, number>();
  for (const e of events) {
    const need = passedScreenNeed(e);
    if (need) passed.set(need, (passed.get(need) ?? 0) + 1);
  }
  const lines: ActivityLine[] = [];
  const grouped = new Set<string>();
  for (const e of events) {
    if (QUIET_TYPES.has(e.type)) continue;
    const need = passedScreenNeed(e);
    if (need) {
      if (grouped.has(need)) continue;
      grouped.add(need);
      lines.push({ key: `screened-${e.slipId}-${need}`, actor: e.actor, title: plain(screenedGroupTitle(need, passed.get(need) ?? 1)), detail: null });
      continue;
    }
    const { title, detail } = describeEvent(e);
    lines.push({ key: `${e.slipId}-${e.seq}`, actor: e.actor, title: plain(title), detail: detail ? plain(detail) : null });
  }
  return lines.slice(-limit);
}

/* --------------------------------------------------------- request screen */

export interface RequestScreenRow {
  /** Null when the row comes from the same source as most rows; the source name when it differs. */
  source: string | null;
  status: ScreenStatus;
  statusWord: string;
  reason: string;
  quote: string | null;
  clauseIds: string[];
}

export interface RequestScreenView {
  /** "Your ask was checked first: 5 of 5 passed" */
  heading: string;
  passed: number;
  total: number;
  allPassed: boolean;
  /** Open when something needs attention; collapsed to the heading when everything passed. */
  openByDefault: boolean;
  rows: RequestScreenRow[];
}

/** The short name before the colon: "Second Look: scam tactics in seller text" becomes "Second Look". */
export function sourceShortName(label: string): string {
  const i = label.indexOf(":");
  return (i > 0 ? label.slice(0, i) : label).trim();
}

/**
 * One heading with a pass count, and rows that carry only their reason. A source is named on a row
 * only when its label differs from the one most rows share.
 */
export function requestScreenView(results: ScreenResult[]): RequestScreenView {
  const labels = results.map((r) => SCREEN_SOURCES[r.screen]?.label ?? r.screen);
  const tally = new Map<string, number>();
  for (const l of labels) tally.set(l, (tally.get(l) ?? 0) + 1);
  let common = "";
  let best = 0;
  for (const [l, n] of tally) {
    if (n > best) {
      common = l;
      best = n;
    }
  }
  const passed = results.filter((r) => r.status === "pass").length;
  const total = results.length;
  const rows = results.map((r, i) => {
    const row = screenRow(r);
    return {
      source: labels[i] === common ? null : sourceShortName(labels[i]),
      status: row.status,
      statusWord: row.statusWord,
      reason: row.reason,
      quote: row.quote,
      clauseIds: row.clauseIds,
    };
  });
  const allPassed = total > 0 && passed === total;
  return { heading: `Your ask was checked first: ${passed} of ${total} passed`, passed, total, allPassed, openByDefault: !allPassed, rows };
}
