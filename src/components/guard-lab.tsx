"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { INTEGRITY_CLAUSE_ID, type Clause, type Proposal, type Verdict } from "@/core/contracts";
import { guard } from "@/core/guard";
import { formatMoney, fromCents, toCents } from "@/core/money";
import type { GuardLab } from "@/server/guard-lab";
import { VerdictStamp } from "./verdict-stamp";

/* The editable facts: one entry per proposal item, in ledger order. */
interface Edit {
  included: boolean;
  quantity: number;
  category: string;
  delivery: string;
  power: string;
  injection: boolean;
}

type ClauseState = "broken" | "unknown" | "clear";

const WORDS: Record<Verdict["decision"], string> = { within: "within", outside: "outside", ask: "needs your call" };
const STAMP_WORD: Record<Verdict["decision"], string> = { within: "WITHIN SLIP", outside: "OUTSIDE SLIP", ask: "NEEDS YOUR CALL" };
const HOLDER: Record<Verdict["decision"], string> = {
  within: "bg-pp-sky text-night",
  outside: "bg-stamp-red text-on-plate",
  ask: "bg-pp-gold text-night",
};
/* The caption area takes the stamp band's colour, so the stamp and the amount read as one card. */
const FIGURE_BASE =
  "[&_.stamp-clause]:font-display [&_.stamp-clause]:text-4xl [&_.stamp-clause]:font-extrabold [&_.stamp-clause]:leading-none [&_.stamp-clause]:tabular-nums [&_.stamp-clause]:tracking-tight [&>div:last-child]:py-7";
const SURFACE: Record<Verdict["decision"], string> = {
  within: `${FIGURE_BASE} [&>div:last-child]:bg-pp-sky [&_.stamp-clause]:text-night`,
  outside: `${FIGURE_BASE} [&>div:last-child]:bg-stamp-red [&_.stamp-clause]:text-on-plate`,
  ask: `${FIGURE_BASE} [&>div:last-child]:bg-pp-gold [&_.stamp-clause]:text-night`,
};
const CHIP: Record<ClauseState, string> = {
  broken: "bg-stamp-red text-on-plate",
  unknown: "bg-pp-gold text-night",
  clear: "bg-pp-sky text-night",
};
const STATE_WORD: Record<ClauseState, string> = { broken: "Broken", unknown: "Unknown", clear: "Clear" };

const POWER_BASE = ["none", "wind_up", "battery", "rechargeable"];
const CATEGORY_BASE = ["gift_card", "electronics", "book"];

const BTN_SECONDARY =
  "inline-flex min-h-11 items-center rounded-pill border border-edge bg-card px-5 text-sm font-semibold text-ink transition-colors duration-[120ms] hover:border-ink active:bg-paper-deep disabled:cursor-not-allowed disabled:opacity-55";
const BTN_SMALL =
  "inline-flex min-h-11 max-w-full items-center truncate whitespace-nowrap rounded-pill border border-edge bg-card px-4 text-sm font-semibold text-ink transition-colors duration-[120ms] hover:border-ink active:bg-paper-deep disabled:cursor-not-allowed disabled:opacity-55";

const dedupe = (list: string[]) => [...new Set(list.filter((x) => x !== ""))];
const key = (s: string) => s.trim().toLowerCase();
const label = (s: string) => s.replace(/_/g, " ");
const day = (s: string | null) => (s ? s.slice(0, 10) : "");

function initialEdits(proposal: Proposal): Edit[] {
  return proposal.items.map((it) => {
    const power = it.facts.attributes.power_source;
    return {
      included: true,
      quantity: it.quantity,
      category: it.facts.category ?? "",
      delivery: it.facts.deliveryEstimate ?? "",
      power: power === undefined || power === null ? "" : String(power),
      injection: it.facts.injectionSuspected,
    };
  });
}

function buildProposal(base: Proposal, edits: Edit[]): Proposal {
  const items = base.items.flatMap((it, i) => {
    const e = edits[i];
    if (!e.included) return [];
    const attributes = { ...it.facts.attributes };
    if (e.power === "") delete attributes.power_source;
    else attributes.power_source = e.power;
    return [
      {
        ...it,
        quantity: e.quantity,
        facts: {
          ...it.facts,
          category: e.category === "" ? null : e.category,
          deliveryEstimate: e.delivery === "" ? null : e.delivery,
          attributes,
          injectionSuspected: e.injection,
        },
      },
    ];
  });
  const cents = items.reduce((sum, it) => sum + it.quantity * toCents(it.unitPrice), 0);
  return { ...base, items, amount: fromCents(cents, base.amount.currency) };
}

function clauseState(id: string, v: Verdict): { state: ClauseState; lines: string[] } {
  const broken = v.violations.filter((x) => x.clauseId === id).map((x) => x.message);
  if (broken.length) return { state: "broken", lines: broken };
  const unknown = v.unknowns.filter((x) => x.clauseId === id).map((x) => x.message);
  if (unknown.length) return { state: "unknown", lines: unknown };
  return { state: "clear", lines: [] };
}

/** The guard words each message as "<label>: <rest>". The row already shows the label, so keep the rest. */
function trimLabel(message: string, name: string): string {
  const prefix = `${name}: `;
  if (!message.startsWith(prefix) || message.length === prefix.length) return message;
  const rest = message.slice(prefix.length);
  return rest.charAt(0).toLowerCase() === rest.charAt(0) ? rest.charAt(0).toUpperCase() + rest.slice(1) : rest;
}

function Field({ id, name, children }: { id: string; name: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-ink-soft">
        {name}
      </label>
      {children}
    </div>
  );
}

export function GuardLabClient({ lab }: { lab: GuardLab }) {
  const { slip, proposal: original, stored, seq, hash, spent, now } = lab;
  const [edits, setEdits] = useState<Edit[]>(() => initialEdits(original));
  const [dirty, setDirty] = useState(false);

  const when = useMemo(() => new Date(now), [now]);
  const proposal = useMemo(() => buildProposal(original, edits), [original, edits]);
  const verdict = useMemo(() => guard(slip, proposal, { spent, now: when }), [slip, proposal, spent, when]);

  const categoryClause = slip.clauses.find((c): c is Extract<Clause, { kind: "category_in" }> => c.kind === "category_in");
  const allowedCategories = slip.clauses.flatMap((c) => (c.kind === "category_in" ? c.categories : []));
  const powerClause = slip.clauses.find(
    (c): c is Extract<Clause, { kind: "exclude_attribute" }> => c.kind === "exclude_attribute" && c.attribute === "power_source",
  );
  const batteryValue = powerClause ? String(powerClause.values.find((x) => typeof x === "string" && key(x) === "battery") ?? powerClause.values[0]) : "battery";

  const includedCount = edits.filter((e) => e.included).length;
  const change = (i: number, patch: Partial<Edit>) => {
    setDirty(true);
    setEdits((prev) => prev.map((e, n) => (n === i ? { ...e, ...patch } : e)));
  };
  const changeAll = (fn: (e: Edit, i: number) => Edit) => {
    setDirty(true);
    setEdits((prev) => prev.map(fn));
  };
  const reset = () => {
    setDirty(false);
    setEdits(initialEdits(original));
  };

  /* Quick moves, only where they apply to these facts. */
  const moves: { id: string; text: string; run: () => void }[] = [];
  if (edits.some((e) => e.injection)) {
    moves.push({ id: "clear-injection", text: "Clear the injection flag", run: () => changeAll((e) => ({ ...e, injection: false })) });
  }
  if (categoryClause && includedCount > 1) {
    original.items.forEach((it, i) => {
      const e = edits[i];
      if (e.included && !allowedCategories.map(key).includes(key(e.category))) {
        moves.push({ id: `remove-${i}`, text: `Remove ${it.title}`, run: () => change(i, { included: false }) });
      }
    });
  }
  if (edits.some((e) => e.included && e.quantity > 1)) {
    moves.push({ id: "quantities", text: "Set quantities to 1", run: () => changeAll((e) => ({ ...e, quantity: 1 })) });
  }
  if (powerClause && original.items[0] && edits[0].power !== batteryValue) {
    moves.push({
      id: "batteries",
      text: `Make ${original.items[0].title} need batteries`,
      run: () => change(0, { power: batteryValue }),
    });
  }

  /* Moves unmount once applied. Remember which one ran and where it sat, then focus the next survivor. */
  const moveRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const verdictRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<number | null>(null);
  const moveKey = moves.map((m) => m.id).join("|");
  useEffect(() => {
    const at = pendingFocus.current;
    if (at === null) return;
    pendingFocus.current = null;
    const ids = moveKey === "" ? [] : moveKey.split("|");
    const next = ids.length > 0 ? moveRefs.current.get(ids[Math.min(at, ids.length - 1)]) : undefined;
    (next ?? verdictRef.current)?.focus();
  }, [moveKey]);

  const match = verdict.decision === stored.decision;
  const rows = [...slip.clauses.map((c) => ({ id: c.id, name: c.label })), { id: INTEGRITY_CLAUSE_ID, name: "Listing text integrity" }];
  const broken = verdict.violations.length;
  const unknown = verdict.unknowns.length;
  const bareVerdict: Verdict = { ...verdict, violations: [], unknowns: [] };
  const count = proposal.items.reduce((n, it) => n + it.quantity, 0);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-6 lg:grid-cols-12">
      <div className="min-w-0 lg:col-span-7">
        <div className="overflow-hidden rounded-card border border-line bg-card">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-paper-deep px-5 py-4">
            <p className="mr-auto text-sm font-semibold text-ink">Quick moves</p>
            {moves.length === 0 ? <p className="text-sm text-ink-soft">None apply to these facts.</p> : null}
            {moves.map((m) => (
              <button
                key={m.id}
                type="button"
                data-move={m.id}
                ref={(el) => {
                  if (el) moveRefs.current.set(m.id, el);
                  else moveRefs.current.delete(m.id);
                }}
                onClick={() => {
                  pendingFocus.current = moves.findIndex((x) => x.id === m.id);
                  m.run();
                }}
                title={m.text} aria-label={m.text} className={BTN_SMALL}>
                {m.text}
              </button>
            ))}
          </div>
          <ul className="divide-y divide-line" aria-label="Items in the proposal">
            {original.items.map((it, i) => {
              const e = edits[i];
              const lastOne = e.included && includedCount === 1;
              const cats = dedupe([...allowedCategories, it.facts.category ?? "", ...CATEGORY_BASE]);
              const powers = dedupe([...POWER_BASE, e.power, ...(powerClause ? powerClause.values.map(String) : [])]);
              const startPower = initialEdits(original)[i].power;
              const id = `lab-${i}`;
              return (
                <li key={i} className="px-5 py-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className={`min-w-0 text-base font-semibold ${e.included ? "text-ink" : "text-ink-faint line-through"}`}>{it.title}</p>
                    <p className="text-sm text-ink-soft">
                      <span className="font-semibold tabular-nums text-ink">{formatMoney(it.unitPrice)}</span> each
                    </p>
                  </div>
                  <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-x-5 gap-y-4 sm:grid-cols-2">
                    <div className="min-w-0">
                      <label htmlFor={`${id}-in`} className="flex min-h-11 items-center gap-3 text-base font-semibold text-ink">
                        <input
                          id={`${id}-in`}
                          type="checkbox"
                          className="h-4 w-4 accent-pp-blue"
                          checked={e.included}
                          disabled={lastOne}
                          onChange={(ev) => change(i, { included: ev.target.checked })}
                        />
                        In the cart
                      </label>
                      {lastOne ? <p className="text-sm text-ink-soft">The last item stays in.</p> : null}
                    </div>
                    <div className="min-w-0">
                      <span id={`${id}-q`} className="mb-1 block text-sm font-semibold text-ink-soft">
                        Quantity
                      </span>
                      <div role="group" aria-labelledby={`${id}-q`} className="flex items-center gap-2">
                        <button
                          type="button"
                          aria-label={`One fewer ${it.title}`}
                          className="lab-step-btn h-11 w-11 rounded-pill border border-edge text-lg font-semibold text-ink active:bg-paper-deep aria-disabled:cursor-not-allowed aria-disabled:opacity-55"
                          aria-disabled={e.quantity <= 1 ? "true" : undefined}
                          onClick={() => {
                            if (e.quantity <= 1) return;
                            change(i, { quantity: e.quantity - 1 });
                          }}
                        >
                          −
                        </button>
                        <output className="w-10 text-center text-base font-semibold tabular-nums text-ink">
                          {e.quantity}
                        </output>
                        <button
                          type="button"
                          aria-label={`One more ${it.title}`}
                          className="lab-step-btn h-11 w-11 rounded-pill border border-edge text-lg font-semibold text-ink active:bg-paper-deep aria-disabled:cursor-not-allowed aria-disabled:opacity-55"
                          aria-disabled={e.quantity >= 9 ? "true" : undefined}
                          onClick={() => {
                            if (e.quantity >= 9) return;
                            change(i, { quantity: e.quantity + 1 });
                          }}
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <Field id={`${id}-cat`} name="Category">
                      <select id={`${id}-cat`} className="field min-h-11 w-full px-4 py-2.5 text-base" value={e.category} onChange={(ev) => change(i, { category: ev.target.value })}>
                        {it.facts.category === null ? <option value="">Unknown</option> : null}
                        {cats.map((c) => (
                          <option key={c} value={c}>
                            {label(c)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field id={`${id}-date`} name="Delivery date">
                      <input
                        id={`${id}-date`}
                        type="date"
                        className="field min-h-11 w-full px-4 py-2.5 text-base tabular-nums"
                        value={day(e.delivery)}
                        onChange={(ev) => change(i, { delivery: ev.target.value })}
                      />
                    </Field>
                    <Field id={`${id}-pow`} name="Power source">
                      <select id={`${id}-pow`} className="field min-h-11 w-full px-4 py-2.5 text-base" value={e.power} onChange={(ev) => change(i, { power: ev.target.value })}>
                        {startPower === "" ? <option value="">Not stated</option> : null}
                        {powers.map((p) => (
                          <option key={p} value={p}>
                            {label(p)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <label htmlFor={`${id}-inj`} className="flex min-h-11 items-center gap-3 self-end text-base font-semibold text-ink">
                      <input
                        id={`${id}-inj`}
                        type="checkbox"
                        className="h-4 w-4 shrink-0 accent-pp-blue"
                        checked={e.injection}
                        onChange={(ev) => change(i, { injection: ev.target.checked })}
                      />
                      Listing text tried to instruct the agent
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line px-5 py-4">
            <p className="text-sm text-ink-soft">The total is recomputed from the items.</p>
            <p className="text-sm text-ink-soft">
              Total <span className="text-xl font-semibold tabular-nums text-ink">{formatMoney(proposal.amount)}</span>
            </p>
          </div>
        </div>
      </div>

      <div className="min-w-0 lg:col-span-5">
        <div className="space-y-4 lg:sticky lg:top-24">
          <div ref={verdictRef} tabIndex={-1} role="group" aria-label="Verdict" className="rounded-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-blue">
            <VerdictStamp
              verdict={bareVerdict}
              className={SURFACE[verdict.decision]}
              caption={`${formatMoney(proposal.amount)}, ${count} ${count === 1 ? "unit" : "units"}`}
            />
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink">
            {match ? (
              <span className="rounded-pill border border-stamp-green bg-green-wash px-3 py-1 font-semibold text-stamp-green">Same call as ledger #{seq}</span>
            ) : (
              <span className="font-semibold">
                Ledger #{seq} said {WORDS[stored.decision]}. Your edits say {WORDS[verdict.decision]}.
              </span>
            )}
            <span className="font-mono text-xs text-ink-soft">{hash.slice(0, 12)}</span>
          </p>
          <div className="rounded-card border border-line bg-card">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 px-5 py-3">
              <h3 className="text-sm font-semibold text-ink">Clause board</h3>
              <p className="text-sm text-ink-soft tabular-nums">
                {broken} broken, {unknown} unknown
              </p>
            </div>
            <ul className="divide-y divide-line border-t border-line">
              {rows.map((r) => {
                const { state, lines } = clauseState(r.id, verdict);
                return (
                  <li key={`${r.id}-${state}`} data-state={state} className={`flex gap-3 px-5 py-3 ${dirty ? "lab-flip" : ""}`}>
                    <span className={`mt-px h-6 min-w-9 shrink-0 rounded-xs px-2 text-center font-mono text-xs font-semibold leading-6 ${CHIP[state]}`}>{r.id}</span>
                    <div className="min-w-0 text-sm">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ink">
                        <span className={`rounded-pill px-2 py-0.5 text-xs font-semibold ${CHIP[state]}`}>{STATE_WORD[state]}</span>
                        <span className="min-w-0 font-semibold">{r.name}</span>
                      </p>
                      {lines.map((m, n) => (
                        <p key={n} className="mt-1 text-ink-soft">
                          {trimLabel(m, r.name)}
                        </p>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
          <button type="button" onClick={reset} disabled={!dirty} className={BTN_SECONDARY}>
            {"Back to the ledger's facts"}
          </button>
        </div>
      </div>
      <div
        aria-hidden="true"
        className={`sticky bottom-0 z-[200] -mx-[var(--gutter)] flex min-h-11 items-center justify-between gap-x-3 px-[var(--gutter)] py-2 lg:hidden ${HOLDER[verdict.decision]}`}
      >
        <span className="font-display text-base font-extrabold leading-none tracking-[0.06em]">{STAMP_WORD[verdict.decision]}</span>
        <span className="text-sm font-semibold tabular-nums">{formatMoney(proposal.amount)}</span>
      </div>
    </div>
  );
}

export default GuardLabClient;
