"use client";
/** PaySmart panels: request screen, handoff, funnel, product board, choose, sign, clarify, delivery, refund, receipt. */
import Image from "next/image";
import Link from "next/link";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import type { Clause, LedgerEvent, Money } from "@/core/contracts";
import { formatMoney } from "@/core/money";
import { EvidencePackView } from "@/components/evidence-pack-view";
import { FileDrop } from "@/components/file-drop";
import { MoneyTag } from "@/components/money-tag";
import { SignWithPayPal } from "@/components/sign-with-paypal";
import { VerdictStamp } from "@/components/verdict-stamp";
import { SAMPLE_PHOTO_BASE64, SAMPLE_PHOTO_CONTENT_TYPE } from "@/pipelines/shop/sample-photo";
import type { PaySmartOption, PaySmartRuledOut, PaySmartState, ProductCard, ScreenResult, SearchRun } from "@/pipelines/paysmart/types";
import { AFFILIATE_DISCLOSURE } from "../shop/panels";
import { ListenForApproval } from "../shop/voice-controls";
import type { ParsedVoiceCommand } from "@/pipelines/shop/voice";
import {
  DISPUTE_READY,
  FILTERS,
  FILTER_WORDS,
  REMOVABLE_KINDS,
  STATUS_WORDS,
  activityHeading,
  activityLines,
  buildLanes,
  countsLine,
  pendingLine,
  sourceName,
  anyAffiliate,
  budgetOf,
  buildAttestations,
  clausesChanged,
  editClauses,
  evidenceHref,
  fieldLabel,
  filterCounts,
  funnelSteps,
  holdLine,
  optionTitle,
  payLabel,
  receiptRows,
  requestScreenView,
  retailerLink,
  screenRow,
  signals,
  sourceTag,
  unknownFields,
  type BoardFilter,
  type RequestScreenRow,
} from "./view";

export const PANEL = "rounded-card border border-pp-gold bg-pp-gold-wash p-5 sm:p-6";
const WAITING = "text-sm font-semibold text-stamp-amber";
export const PRIMARY =
  "inline-flex h-11 items-center rounded-pill bg-ink px-6 text-sm font-semibold text-on-night transition-colors duration-[120ms] hover:bg-pp-deep active:bg-night-3 disabled:cursor-not-allowed disabled:opacity-55";
const DANGER =
  "inline-flex h-11 items-center rounded-pill border border-stamp-red bg-card px-5 text-sm font-semibold text-stamp-red transition-colors duration-[120ms] hover:bg-red-wash active:bg-red-wash disabled:cursor-not-allowed disabled:opacity-55";
export const QUIET =
  "inline-flex h-11 items-center rounded-pill border border-edge bg-card px-5 text-sm font-semibold text-ink transition-colors duration-[120ms] hover:border-ink active:bg-paper-deep disabled:cursor-not-allowed disabled:opacity-55";
const TEXT_ACTION =
  "font-semibold text-pp-blue underline decoration-line underline-offset-4 transition-colors duration-[120ms] hover:decoration-pp-blue active:text-pp-deep disabled:cursor-not-allowed disabled:opacity-55";
export const INPUT = "field h-11 px-4 text-base text-ink disabled:cursor-not-allowed disabled:opacity-55";

export type Send = (signal: unknown) => Promise<void>;

function useSender(send: Send) {
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  async function run(signal: unknown) {
    setState({ busy: true, error: null });
    try {
      await send(signal);
      setState({ busy: false, error: null });
    } catch (e) {
      setState({ busy: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { ...state, run };
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="mt-3 text-sm text-stamp-red">
      {error}
    </p>
  ) : null;
}

function Problem({ text }: { text: string | null }) {
  return text ? (
    <p role="alert" className="mt-3 rounded-md border border-stamp-red bg-red-wash px-4 py-2.5 text-sm font-semibold text-stamp-red">
      {text}
    </p>
  ) : null;
}

/* ---------------------------------------------------------------- screens */

const STATUS_CHIP: Record<ScreenResult["status"], string> = {
  pass: "border-stamp-green bg-green-wash text-stamp-green",
  fail: "border-stamp-red bg-red-wash text-stamp-red",
  ask: "border-pp-gold bg-pp-gold-wash text-stamp-amber",
  skipped: "border-line text-ink-soft",
};

/** One screen result as a row: who ran it, what it found, the quoted line. */
function ScreenRowView({ result }: { result: ScreenResult }) {
  const row = screenRow(result);
  return (
    <li className="py-2.5 text-sm text-ink">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-semibold">{row.source}</span>
        <span className={`rounded-pill border px-2 py-0.5 text-xs font-semibold ${STATUS_CHIP[row.status]}`}>{row.statusWord}</span>
      </p>
      <p className="mt-1 text-ink-soft">{row.reason}</p>
      {row.quote ? (
        <blockquote className="mt-1.5 border-l-2 border-stamp-red pl-3 font-mono text-xs text-ink [overflow-wrap:anywhere]">
          <span className="sr-only">Quoted line: </span>
          {row.quote}
        </blockquote>
      ) : null}
      {row.clauseIds.length ? (
        <p className="mt-1.5 flex flex-wrap gap-1.5 text-xs text-ink-soft">
          <span>Clauses:</span>
          {row.clauseIds.map((c) => (
            <span key={c} className="rounded-xs bg-paper-deep px-2 font-mono font-semibold">
              {c}
            </span>
          ))}
        </p>
      ) : null}
    </li>
  );
}

/** One request-screen row: the reason, with a source name only when it differs from the rest. */
function RequestRowView({ row }: { row: RequestScreenRow }) {
  return (
    <li className="py-2.5 text-sm text-ink">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={`rounded-pill border px-2 py-0.5 text-xs font-semibold ${STATUS_CHIP[row.status]}`}>{row.statusWord}</span>
        {row.source ? <span className="font-semibold">{row.source}</span> : null}
        <span className="text-ink-soft">{row.reason}</span>
      </p>
      {row.quote ? (
        <blockquote className="mt-1.5 border-l-2 border-stamp-red pl-3 font-mono text-xs text-ink [overflow-wrap:anywhere]">
          <span className="sr-only">Quoted line: </span>
          {row.quote}
        </blockquote>
      ) : null}
      {row.clauseIds.length ? (
        <p className="mt-1.5 flex flex-wrap gap-1.5 text-xs text-ink-soft">
          <span>Clauses:</span>
          {row.clauseIds.map((c) => (
            <span key={c} className="rounded-xs bg-paper-deep px-2 font-mono font-semibold">
              {c}
            </span>
          ))}
        </p>
      ) : null}
    </li>
  );
}

/** One heading with the pass count. Collapsed to that line when everything passed; open when something did not. */
export function RequestScreenStrip({ results }: { results: ScreenResult[] }) {
  if (!results.length) return null;
  const view = requestScreenView(results);
  return (
    <section className="rounded-card border border-line bg-card px-5" aria-label="Request screen">
      <details open={view.openByDefault} className="group">
        <summary className="flex min-h-14 cursor-pointer list-none flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 [&::-webkit-details-marker]:hidden">
          <h2 className="font-display text-lg font-extrabold tracking-tight text-ink">{view.heading}</h2>
          <span className="text-sm font-semibold text-pp-blue underline decoration-line underline-offset-4">
            <span className="group-open:hidden">Show checks</span>
            <span className="hidden group-open:inline">Hide checks</span>
          </span>
        </summary>
        <ul role="list" className="divide-y divide-line border-t border-line pb-2">
          {view.rows.map((row, i) => (
            <RequestRowView key={`${row.reason}-${i}`} row={row} />
          ))}
        </ul>
      </details>
    </section>
  );
}

export function HandoffCard({ handoff }: { handoff: NonNullable<PaySmartState["handoff"]> }) {
  return (
    <section className="rounded-card border-2 border-ink bg-card p-5 sm:p-6" aria-label="Handed to another pipeline">
      <p className="text-sm font-semibold text-ink-soft">This is not a shopping ask</p>
      <p className="mt-1 font-display text-xl font-extrabold tracking-tight text-ink">{handoff.label}</p>
      <p className="mt-2 text-base text-ink">{handoff.why}</p>
      {handoff.quotes.length ? (
        <ul role="list" className="mt-3 space-y-1.5" aria-label="Lines from your ask">
          {handoff.quotes.map((q, i) => (
            <li key={i} className="border-l-2 border-stamp-red pl-3 font-mono text-xs text-ink [overflow-wrap:anywhere]">
              {q}
            </li>
          ))}
        </ul>
      ) : null}
      <Link href={handoff.path} className={`${PRIMARY} mt-5`}>
        Open {handoff.path}
      </Link>
    </section>
  );
}

/* --------------------------------------------------------------- activity */

export function ActivityList({ events, running, step }: { events: LedgerEvent[]; running: boolean; step?: string }) {
  const lines = activityLines(events);
  if (!lines.length && !running) return null;
  return (
    <section aria-label="Agent activity">
      <h2 className="border-b border-line pb-3 font-display text-xl font-extrabold tracking-tight text-ink">{activityHeading(step)}</h2>
      {lines.length ? (
        <ol className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1" aria-live="polite" aria-relevant="additions">
          {lines.map((l) => (
            <li key={l.key} className="border-l-2 border-line pl-4 text-sm text-ink">
              <span className="font-semibold">{l.title}</span>
              {l.detail ? <span className="block text-ink-soft [overflow-wrap:anywhere]">{l.detail}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
      {running ? (
        <p className="mt-3 text-sm text-ink-soft" role="status">
          Working…
        </p>
      ) : null}
    </section>
  );
}

/* ----------------------------------------------------------------- funnel */

export function FunnelStrip({ funnel }: { funnel: NonNullable<PaySmartState["funnel"]> }) {
  const steps = funnelSteps(funnel);
  return (
    <section aria-label="How many listings made it through each screen">
      <ol className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-5">
        {steps.map((s) => (
          <li key={s.key} className="bg-card px-4 py-3">
            <p className="font-display text-3xl font-extrabold leading-none tabular-nums text-ink">{s.value}</p>
            <p className="mt-1 text-xs font-semibold text-ink-soft">{s.label}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------ product board */

const PRODUCT_CHIP: Record<ProductCard["status"], string> = {
  eligible: "border-stamp-green bg-green-wash text-stamp-green",
  ruled_out: "border-stamp-red bg-red-wash text-stamp-red",
  needs_you: "border-pp-gold bg-pp-gold-wash text-stamp-amber",
  unchecked: "border-line text-ink-soft",
};

function ProductView({ p }: { p: ProductCard }) {
  const tag = sourceTag(p.source, p.domain);
  const link = retailerLink(p);
  return (
    <li className={`rounded-card border bg-card p-4 ${p.status === "ruled_out" ? "border-stamp-red" : "border-line"}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-base font-semibold leading-snug text-ink [overflow-wrap:anywhere]">{p.title}</p>
        <span className="text-lg">
          <MoneyTag money={p.price} tone={p.status === "ruled_out" ? "muted" : "neutral"} />
        </span>
      </div>
      <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
        <span>{p.domain}</span>
        {tag ? (
          <span className={`rounded-pill border px-2.5 py-0.5 font-semibold ${tag.tone === "red" ? "border-stamp-red text-stamp-red" : "border-edge text-ink-soft"}`}>{tag.label}</span>
        ) : null}
        <span className={`rounded-pill border px-2.5 py-0.5 font-semibold ${PRODUCT_CHIP[p.status]}`}>{STATUS_WORDS[p.status]}</span>
      </p>
      {p.screens.length ? (
        <ul role="list" className="mt-2 divide-y divide-line border-t border-line" aria-label={`Screens for ${p.title}`}>
          {p.screens.map((s, i) => (
            <ScreenRowView key={`${s.screen}-${i}`} result={s} />
          ))}
        </ul>
      ) : null}
      {link ? (
        <p className="mt-2">
          {link.href ? (
            <a href={link.href} target="_blank" rel={link.rel} className={`text-xs ${TEXT_ACTION}`}>
              View at {p.domain}
            </a>
          ) : (
            <span className="text-xs text-ink-soft">
              Sample shop link: <span className="break-all font-mono">{link.text}</span>
            </span>
          )}
        </p>
      ) : null}
    </li>
  );
}

function LaneView({ lane }: { lane: ReturnType<typeof buildLanes>[number] }) {
  const s: SearchRun | null = lane.search;
  return (
    <section className="rounded-card border border-line bg-paper-deep/40 p-4 sm:p-5" aria-label={`Search for ${lane.need}`}>
      <h3 className="font-display text-lg font-extrabold tracking-tight text-ink">{lane.need}</h3>
      {lane.pending ? (
        <p className="mt-2 text-sm text-ink-soft" role="status">
          {pendingLine(lane.need)}
        </p>
      ) : null}
      {s ? (
        <>
          <p className="mt-1 text-sm text-ink">
            Searched <q className="font-semibold">{s.query}</q> in {sourceName(s.source)}, up to {formatMoney(s.maxPrice)}
          </p>
          <p className="mt-1 text-xs font-semibold text-ink-soft">{countsLine(s)}</p>
        </>
      ) : null}
      {lane.products.length ? (
        <ul role="list" className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3 xl:grid-cols-2">
          {lane.products.map((p) => (
            <ProductView key={p.listingId} p={p} />
          ))}
        </ul>
      ) : !lane.pending && !lane.dropped.length ? (
        <p className="mt-3 text-sm text-ink-soft">Nothing here for this tab.</p>
      ) : null}
      {lane.dropped.length ? (
        <details open={lane.droppedOpen} className="mt-3 rounded-md border border-line bg-card px-4 py-1">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-stamp-red">Dropped ({lane.dropped.length})</summary>
          <ul role="list" className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-3 pb-3 xl:grid-cols-2">
            {lane.dropped.map((p) => (
              <ProductView key={p.listingId} p={p} />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

/** What PaySmart understood, then one lane per search with that need's products. Filters apply inside the lanes. */
export function DiscoveryBoard({ state }: { state: PaySmartState }) {
  const [filter, setFilter] = useState<BoardFilter>("all");
  const products = state.products ?? [];
  const searches = state.searches ?? [];
  const needs = state.route?.needs ?? [];
  const counts = filterCounts(products);
  const lanes = buildLanes(
    needs.map((n) => n.need),
    searches,
    products,
    filter,
  );
  if (!needs.length && !searches.length && !products.length) return null;
  return (
    <section aria-label="Discovery" className="space-y-4">
      {state.route && needs.length ? (
        <div aria-label="What I understood">
          <h2 className="border-b border-line pb-3 font-display text-xl font-extrabold tracking-tight text-ink">What I understood</h2>
          {state.route.summary ? <p className="mt-3 text-base text-ink">{state.route.summary}</p> : null}
          <ul role="list" className="mt-2 flex flex-wrap gap-2" aria-label="Things to find">
            {needs.map((n) => (
              <li key={n.need} className="rounded-pill border border-edge bg-card px-3 py-1 text-sm font-semibold text-ink">
                {n.quantity > 1 ? `${n.quantity} × ` : ""}
                {n.need}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {state.funnel ? <FunnelStrip funnel={state.funnel} /> : null}
      <div role="group" aria-label="Filter listings" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={`inline-flex h-11 items-center gap-2 rounded-pill border px-4 text-sm font-semibold transition-colors duration-[120ms] ${filter === f ? "border-ink bg-ink text-on-night" : "border-edge bg-card text-ink hover:border-ink"}`}
          >
            {FILTER_WORDS[f]}
            <span className="tabular-nums opacity-80">{counts[f]}</span>
          </button>
        ))}
      </div>
      <div className="space-y-4">
        {lanes.map((l) => (
          <LaneView key={l.key} lane={l} />
        ))}
      </div>
      {anyAffiliate(products) ? <p className="text-xs text-ink-soft">{AFFILIATE_DISCLOSURE}</p> : null}
    </section>
  );
}

/* ---------------------------------------------------------------- choose */

const DECISION_LOOK = {
  within: { word: "WITHIN SLIP", chip: "bg-pp-sky text-night" },
  ask: { word: "NEEDS YOUR CALL", chip: "bg-pp-gold text-night" },
  outside: { word: "OUTSIDE SLIP", chip: "bg-stamp-red text-on-plate" },
} as const;

function RuledOutList({ items }: { items: PaySmartRuledOut[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-5">
      <p className="text-sm font-semibold text-stamp-red">Ruled out by the guard</p>
      <ul role="list" className="mt-3 space-y-2">
        {items.map((r, i) => (
          <li key={`${r.title}-${i}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-card border border-line bg-card px-5 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink [overflow-wrap:anywhere]">{r.title}</p>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
                <span>Broke:</span>
                {r.clauseIds.map((cid) => (
                  <span key={cid} className="rounded-xs bg-stamp-red px-2 py-0.5 font-mono font-semibold text-on-plate">
                    {cid}
                  </span>
                ))}
              </p>
            </div>
            <span className="text-xl">
              <MoneyTag money={r.amount} tone="muted" />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Up to three stamped carts as a radio group. Arrow keys move the selection. */
function OptionRadios({ options, selectedId, disabled, onSelect }: { options: PaySmartOption[]; selectedId: string; disabled: boolean; onSelect: (id: string) => void }) {
  const base = useId();
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  function move(from: number, step: number) {
    const next = (from + step + options.length) % options.length;
    onSelect(options[next].id);
    refs.current[next]?.focus();
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>, i: number) {
    if (disabled) return;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      move(i, 1);
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      move(i, -1);
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      onSelect(options[i].id);
    }
  }

  return (
    <div className="mt-5">
      <p id={`${base}-label`} className="text-sm font-semibold text-ink">
        Carts the guard checked ({options.length})
      </p>
      <div role="radiogroup" aria-labelledby={`${base}-label`} aria-describedby={`${base}-hint`} className="mt-3 space-y-3">
        {options.map((o, i) => {
          const checked = o.id === selectedId;
          const look = DECISION_LOOK[o.verdict.decision];
          return (
            <div
              key={o.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              role="radio"
              aria-checked={checked}
              aria-disabled={disabled || undefined}
              aria-labelledby={`${base}-${o.id}-title`}
              tabIndex={checked ? 0 : -1}
              onClick={() => (disabled ? undefined : onSelect(o.id))}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`cursor-pointer rounded-card border-2 bg-card px-5 py-4 transition-colors duration-[120ms] ${checked ? "border-ink" : "border-line hover:bg-paper-deep active:bg-line"}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-ink-soft">
                    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="10" cy="10" r="7.5" className={checked ? "text-pp-blue" : "text-edge"} />
                      {checked ? <circle cx="10" cy="10" r="4" fill="currentColor" stroke="none" className="text-pp-blue" /> : null}
                    </svg>
                    Option {o.rank}
                    <span className={`rounded-xs px-2 py-0.5 font-display text-xs font-black ${look.chip}`}>{look.word}</span>
                  </p>
                  <p id={`${base}-${o.id}-title`} className="mt-1.5 text-base font-semibold text-ink [overflow-wrap:anywhere]">
                    {optionTitle(o)}
                  </p>
                  <p className="text-xs text-ink-soft">Sold by {[...new Set(o.lines.map((l) => l.domain))].join(", ")}</p>
                </div>
                <span className="text-2xl">
                  <MoneyTag money={o.proposal.amount} label="Cart total" />
                </span>
              </div>
              {o.rationale ? (
                <p className="mt-3 rounded-md bg-paper-deep px-4 py-3 text-sm text-ink">
                  <span className="block text-xs text-ink-soft">Agent&apos;s note (not checked by the guard)</span>
                  {o.rationale}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      <p id={`${base}-hint`} className="mt-1 text-xs text-ink-faint">
        Use the arrow keys to move between carts, or say &quot;option two&quot;.
      </p>
    </div>
  );
}

/** Slip clause editor: change the limit, drop optional clauses, send them for a re-check. Nothing is paid. */
function ClauseEditor({ clauses, disabled, onRecheck }: { clauses: Clause[]; disabled: boolean; onRecheck: (clauses: Clause[]) => void }) {
  const [budget, setBudget] = useState(budgetOf(clauses));
  const [dropped, setDropped] = useState<string[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const edit = editClauses(clauses, budget, dropped);
  const changed = edit.ok && clausesChanged(clauses, edit.clauses);
  const base = useId();

  function recheck() {
    if (!edit.ok) {
      setLocalError(edit.error);
      return;
    }
    setLocalError(null);
    onRecheck(edit.clauses);
  }

  return (
    <details className="mt-5 rounded-md border border-line bg-card px-4 py-3">
      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-ink">Edit the slip</summary>
      <div className="mt-2 flex flex-wrap items-end gap-x-5 gap-y-3">
        <label className="text-sm text-ink">
          <span className="block text-sm font-semibold text-ink-soft">Spending limit (USD)</span>
          <input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} className={`${INPUT} mt-1.5 w-36 font-semibold tabular-nums`} aria-describedby={`${base}-help`} />
        </label>
        <p id={`${base}-help`} className="pb-2.5 text-xs text-ink-soft">
          PayPal holds the cart total you pick, never more than this.
        </p>
      </div>
      <fieldset className="mt-4">
        <legend className="text-sm font-semibold text-ink-soft">Clauses to keep</legend>
        <ul className="mt-2 divide-y divide-line border-y border-line">
          {clauses.map((c) => (
            <li key={c.id}>
              <label className="flex items-start gap-3 py-2.5 text-base text-ink">
                <input
                  type="checkbox"
                  className="mt-1.5 h-4 w-4 shrink-0 cursor-pointer accent-pp-blue disabled:cursor-not-allowed"
                  checked={!dropped.includes(c.id)}
                  disabled={!REMOVABLE_KINDS.has(c.kind)}
                  onChange={(e) => setDropped((d) => (e.target.checked ? d.filter((x) => x !== c.id) : [...d, c.id]))}
                />
                <span>
                  <span className="mr-1.5 inline-block rounded-xs bg-paper-deep px-2 font-mono text-xs font-semibold text-ink-soft">{c.id}</span> {c.label}
                  {!REMOVABLE_KINDS.has(c.kind) ? <span className="text-xs text-ink-faint"> (required)</span> : null}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <div className="mt-4">
        <button type="button" className={QUIET} disabled={disabled || !changed} onClick={recheck}>
          Re-check options
        </button>
        <p className="mt-1 text-xs text-ink-soft">Every listing and cart is stamped again against the edited slip. Nothing is paid.</p>
      </div>
      <ErrorLine error={localError} />
    </details>
  );
}

export function ChoosePanel({
  message,
  options,
  ruledOut,
  clauses,
  limit,
  problem,
  defaultOptionId,
  onSend,
}: {
  message: string;
  options: PaySmartOption[];
  ruledOut: PaySmartRuledOut[];
  clauses: Clause[];
  limit: Money | null;
  problem: string | null;
  defaultOptionId: string | null;
  onSend: Send;
}) {
  const [selectedId, setSelectedId] = useState(defaultOptionId ?? options[0]?.id ?? "");
  const sel = options.find((o) => o.id === selectedId) ?? options[0];
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const sender = useSender(onSend);
  const fields = unknownFields(sel);

  async function onVoice(cmd: ParsedVoiceCommand) {
    if (cmd.kind === "choose_option") {
      const picked = options[cmd.index - 1];
      if (!picked) throw new Error(`There is no option ${cmd.index}. Say a number from 1 to ${options.length}.`);
      setSelectedId(picked.id);
    } else if (cmd.kind === "approve_cart") {
      if (sel) await sender.run(signals.choose(sel.id, "voice", buildAttestations(fields, answers)));
    } else await sender.run(signals.decline());
  }

  function pay(via: "click" | "keyboard") {
    if (!sel) return;
    void sender.run(signals.choose(sel.id, via, buildAttestations(fields, answers)));
  }

  return (
    <section className={PANEL} aria-label="Choose a cart">
      <p className={WAITING}>Waiting for you</p>
      <p className="mt-1 text-base text-ink">{message}</p>
      {limit ? <p className="mt-1 text-sm text-ink-soft">Your limit: {formatMoney(limit)}</p> : null}
      <Problem text={problem} />
      {sel ? <OptionRadios options={options} selectedId={sel.id} disabled={sender.busy} onSelect={setSelectedId} /> : <p className="mt-4 text-sm text-ink">No cart is left to choose. Edit the slip or decline.</p>}
      <RuledOutList items={ruledOut} />
      {sel ? (
        <>
          <ul className="mt-5 divide-y divide-line border-y border-line" aria-label={`Lines in option ${sel.rank}`}>
            {sel.lines.map((l) => (
              <li key={l.listingId} className="flex flex-wrap items-center justify-between gap-2 py-3 text-base">
                <span className="flex flex-wrap items-baseline gap-x-3 text-ink">
                  <span>
                    {l.quantity} × {l.title}
                  </span>
                  <span className="text-xs text-ink-soft">{l.domain}</span>
                </span>
                <span className="text-lg">
                  <MoneyTag money={l.unitPrice} />
                </span>
              </li>
            ))}
          </ul>
          <VerdictStamp key={sel.id} verdict={sel.verdict} className="mt-3" caption={`Option ${sel.rank}: cart total ${formatMoney(sel.proposal.amount)}`} />
          <p className="mt-3 text-sm text-ink-soft">{holdLine(sel.proposal.amount)}</p>
          {fields.length ? (
            <fieldset className="mt-5 space-y-3">
              <legend className="text-sm font-semibold text-ink">The guard needs you to confirm</legend>
              {fields.map((f) => {
                const id = `attest-${f.replace(/\W/g, "-")}`;
                return (
                  <div key={f} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <label htmlFor={id} className="w-40 text-sm text-ink">
                      {fieldLabel(f)}
                    </label>
                    {f === "inStock" ? (
                      <select id={id} value={answers[f] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [f]: e.target.value }))} className={`${INPUT} min-w-32`}>
                        <option value="">Choose</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    ) : (
                      <input
                        id={id}
                        type={f === "deliveryEstimate" ? "date" : f === "itemCount" ? "number" : "text"}
                        value={answers[f] ?? ""}
                        onChange={(e) => setAnswers((a) => ({ ...a, [f]: e.target.value }))}
                        className={`${INPUT} min-w-32`}
                      />
                    )}
                  </div>
                );
              })}
            </fieldset>
          ) : null}
        </>
      ) : null}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {sel ? (
          <button type="button" className={PRIMARY} disabled={sender.busy} onClick={(e) => pay(e.detail === 0 ? "keyboard" : "click")}>
            {payLabel(sel.proposal.amount)}
          </button>
        ) : null}
        <button type="button" className={DANGER} disabled={sender.busy} onClick={() => void sender.run(signals.decline())}>
          Decline
        </button>
        <ListenForApproval enabled={!sender.busy} onCommand={onVoice} />
      </div>
      {clauses.length ? <ClauseEditor key={JSON.stringify(clauses)} clauses={clauses} disabled={sender.busy} onRecheck={(c) => void sender.run(signals.recheck(c))} /> : null}
      <ErrorLine error={sender.error} />
    </section>
  );
}

/* ------------------------------------------------------------ other waits */

export function ClarifyPanel({ message, problem, onSend }: { message: string; problem: string | null; onSend: Send }) {
  const [text, setText] = useState("");
  const sender = useSender(onSend);
  const id = useId();
  const answer = signals.clarifyAnswer(text);
  return (
    <section className={PANEL} aria-label="A question about your ask">
      <p className={WAITING}>Waiting for you</p>
      <label htmlFor={id} className="mt-1 block text-base font-semibold text-ink">
        {message}
      </label>
      <Problem text={problem} />
      <input id={id} value={text} maxLength={300} onChange={(e) => setText(e.target.value)} className={`${INPUT} mt-3 w-full`} />
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" className={PRIMARY} disabled={sender.busy || !answer} onClick={() => answer && void sender.run(answer)}>
          Send
        </button>
        <button type="button" className={DANGER} disabled={sender.busy} onClick={() => void sender.run(signals.clarifyCancel())}>
          Cancel
        </button>
      </div>
      <ErrorLine error={sender.error} />
    </section>
  );
}

export function SignPanel({ message, approveUrl, amount }: { message: string; approveUrl: string; amount: Money | null }) {
  return (
    <section className={PANEL} aria-label="Pay with PayPal">
      <p className={WAITING}>Waiting for you</p>
      <p className="mt-1 text-base text-ink">{message}</p>
      {amount ? <p className="mt-2 text-sm font-semibold text-ink">{holdLine(amount)}</p> : null}
      <div className="mt-4">
        <SignWithPayPal approveUrl={approveUrl} sdk="v6" label={amount ? payLabel(amount) : "Pay with PayPal"} />
      </div>
    </section>
  );
}

export function DeliveryPanel({ message, accept, onSend }: { message: string; accept: string; onSend: Send }) {
  const sender = useSender(onSend);
  return (
    <section className={PANEL} aria-label="Delivery photo">
      <p className={WAITING}>Waiting for you</p>
      <p className="mt-1 text-base text-ink">{message}</p>
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-[minmax(0,1fr)_auto]">
        <FileDrop accept={accept} disabled={sender.busy} label="Drop the delivery photo here or choose one" onUploaded={(f) => void sender.run(signals.deliveryPhoto(f))} />
        <div className="flex flex-col items-start gap-2">
          <Image
            src={`data:${SAMPLE_PHOTO_CONTENT_TYPE};base64,${SAMPLE_PHOTO_BASE64}`}
            alt="Sample delivery photo: the wind-up T-rex in its box next to a battery pack"
            width={160}
            height={110}
            unoptimized
            className="h-auto w-40 rounded-md border border-line"
          />
          <button type="button" className={QUIET} disabled={sender.busy} onClick={() => void sender.run(signals.deliverySample())}>
            Use sample photo
          </button>
          <button type="button" className={`text-sm ${TEXT_ACTION}`} disabled={sender.busy} onClick={() => void sender.run(signals.deliverySkip())}>
            Skip the delivery check
          </button>
        </div>
      </div>
      <ErrorLine error={sender.error} />
    </section>
  );
}

export function RefundPanel({ message, summary, onSend }: { message: string; summary: string | null; onSend: Send }) {
  const sender = useSender(onSend);
  return (
    <section className={PANEL} aria-label="Confirm the refund">
      <p className={WAITING}>Waiting for you</p>
      <p className="mt-1 text-base text-ink">{message}</p>
      {summary ? <p className="mt-2 text-sm text-ink-soft">{summary}</p> : null}
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" className={PRIMARY} disabled={sender.busy} onClick={() => void sender.run(signals.refund(true))}>
          Refund it
        </button>
        <button type="button" className={QUIET} disabled={sender.busy} onClick={() => void sender.run(signals.refund(false))}>
          Keep the purchase
        </button>
      </div>
      <ErrorLine error={sender.error} />
    </section>
  );
}

/* ---------------------------------------------------------------- receipt */

export function Receipt({ state, slipId }: { state: PaySmartState; slipId: string | null }) {
  const totals = state.totals;
  if (!totals) return null;
  const pack = state.evidencePack;
  return (
    <section className="rounded-card border border-line bg-card p-5 sm:p-6" aria-label="Receipt">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="font-display text-xl font-extrabold tracking-tight text-ink">Receipt</h2>
        {pack ? (
          pack.chain.ok ? (
            <span className="inline-flex gap-x-3 rounded-pill border border-stamp-green bg-green-wash px-3 py-1 text-sm font-semibold text-stamp-green">
              <span>Chain verified</span>
              <span>{pack.events.length} events</span>
            </span>
          ) : (
            <span role="alert" className="rounded-pill border border-stamp-red bg-red-wash px-3 py-1 text-sm font-semibold text-stamp-red">
              Chain broken at #{pack.chain.brokenAtSeq}
            </span>
          )
        ) : null}
      </div>
      <ul role="list" className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-5">
        {receiptRows(totals).map((r) => (
          <li key={r.key}>
            <MoneyTag className="text-2xl" money={r.money} label={r.label} tone={r.tone} />
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-ink">{DISPUTE_READY}</p>
      {slipId ? (
        <p className="mt-2 text-sm">
          <a href={evidenceHref(slipId)} className={TEXT_ACTION}>
            Open the evidence pack
          </a>
          <span className="text-ink-soft"> (JSON, every step chained)</span>
        </p>
      ) : null}
      {state.delivery ? (
        <p className="mt-3 text-sm text-ink-soft">
          Delivery check{state.delivery.sample ? " (sample photo)" : ""}: {state.delivery.check.summary}
        </p>
      ) : null}
      {pack ? (
        <details className="mt-4">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-ink">Show the full evidence pack</summary>
          <EvidencePackView pack={pack} className="mt-2" />
        </details>
      ) : null}
    </section>
  );
}
