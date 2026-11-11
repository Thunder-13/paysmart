"use client";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { Money, Slip } from "@/core/contracts";
import { formatMoney, zeroMoney } from "@/core/money";
import { LedgerTimeline } from "@/components/ledger-timeline";
import { MoneyTag } from "@/components/money-tag";
import { fetchJson, resumeRun, startRun, useRun } from "@/components/run-client";
import { SlipBoard } from "@/components/slip-board";
import { SlipCard } from "@/components/slip-card";
import { WaitPanel } from "@/components/wait-panel";
import { reduceTollEvents, type Stamp } from "@/pipelines/toll-road/counters";
import type { TollState } from "@/pipelines/toll-road/types";
import { RawQuotePanel } from "./raw-402-panel";

export interface ArticleCard {
  id: string;
  title: string;
  summary: string;
  price: Money;
  overCap: boolean;
}

export interface PublisherCardData {
  id: string;
  name: string;
  blurb: string;
  articles: ArticleCard[];
}

export interface TollRoadViewProps {
  initialRunId: string | null;
  publishers: PublisherCardData[];
  baseUrl: string;
  defaults: { question: string; intent: string; cap: Money };
}

const OUTCOME_WORDS: Record<string, string> = {
  paid: "Settled. Publishers paid by usage.",
  nothing_to_settle: "Nothing was fetched, so nothing was charged. The hold was released.",
  declined: "You didn't sign the slip. Nothing happened.",
  not_signed: "PayPal signing was cancelled. The agent never got a slip.",
};

/** Loads a slip by id (the network payout slip), refreshing when the run status changes. */
function useSlip(id: string | null, version: string): Slip | null {
  const [data, setData] = useState<{ id: string; slip: Slip } | null>(null);
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetchJson<{ slip: Slip }>(`/api/slips/${encodeURIComponent(id)}`)
      .then((res) => {
        if (!cancelled) setData({ id, slip: res.slip });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [id, version]);
  return data && data.id === id ? data.slip : null;
}

function StampRow({ stamp }: { stamp: Stamp }) {
  const holder =
    stamp.kind === "paid"
      ? "bg-pp-sky text-night"
      : stamp.kind === "refused"
        ? "bg-stamp-red text-on-plate"
        : stamp.kind === "milestone"
          ? "bg-ink text-on-night"
          : "bg-paper-deep text-ink-soft";
  return (
    <li className="grid animate-rack grid-cols-1 overflow-hidden rounded-md border border-line bg-card motion-reduce:animate-none sm:grid-cols-[10rem_minmax(0,1fr)]">
      <span className={`flex items-center px-4 py-2 text-sm font-semibold tabular-nums ${holder}`}>{stamp.title}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm text-ink">
        <span className="min-w-0 flex-1">{stamp.detail}</span>
        {stamp.injection ? (
          <span className="rounded-pill border border-pp-gold bg-pp-gold-wash px-2.5 py-0.5 text-xs font-semibold text-stamp-amber">
            Injection flagged, kept from the agent
          </span>
        ) : null}
      </span>
    </li>
  );
}

function Counter({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-md bg-night-2 px-4 py-3">
      <dt className="text-sm text-on-night-soft">{label}</dt>
      <dd className="mt-0.5 text-2xl font-semibold tabular-nums text-on-night">{children}</dd>
    </div>
  );
}

export function TollRoadView({ initialRunId, publishers, baseUrl, defaults }: TollRoadViewProps) {
  const [runId, setRunId] = useState<string | null>(initialRunId);
  const [question, setQuestion] = useState(defaults.question);
  const [intent, setIntent] = useState(defaults.intent);
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const { run, slip, events, error: runError, refresh } = useRun(runId);
  const state = (run?.state ?? null) as TollState | null;
  const counters = useMemo(() => reduceTollEvents(events), [events]);
  const networkId = state?.networkSlipId ?? (typeof slip?.meta.networkSlipId === "string" ? slip.meta.networkSlipId : null);
  const network = useSlip(networkId, `${run?.status ?? ""}:${events.length}`);

  const titles = useMemo(() => new Map(publishers.flatMap((p) => p.articles.map((a) => [a.id, a.title] as const))), [publishers]);
  const earned = new Map(counters.byPublisher.map((e) => [e.publisherId, e]));
  const currency = slip?.budget.currency ?? "USD";
  const spent = counters.spent ?? zeroMoney(currency);
  const remaining = counters.remaining ?? slip?.budget ?? zeroMoney(currency);
  const budget = slip ? Number(slip.budget.value) : Number(spent.value) + Number(remaining.value);
  const spentShare = budget > 0 ? Math.min(1, Math.max(0, Number(spent.value) / budget)) : 0;
  const capShare = budget > 0 ? Math.min(1, Math.max(0, Number(defaults.cap.value) / budget)) : 0;
  // Show the start form when there is no run, the run ended, or the run id in the URL could not be loaded.
  const finished = !runId || !!runError || run?.status === "done" || run?.status === "failed";

  async function start(input: { question: string; intent: string }) {
    setBusy(true);
    setStartError(null);
    try {
      const created = await startRun("toll-road", input);
      setRunId(created.id);
      window.history.replaceState(null, "", `/p/toll-road?run=${encodeURIComponent(created.id)}`);
    } catch (e) {
      setStartError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void start({ question, intent });
  }

  async function onResume(signal: unknown) {
    if (!run) return;
    await resumeRun(run.id, signal);
    await refresh();
  }

  return (
    <div className="space-y-12">
      <SlipBoard slipId={slip?.id ?? null} caption="The guard’s calls on this slip, live from its ledger." />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
        <RawQuotePanel articles={publishers.flatMap((p) => p.articles.map((a) => ({ id: a.id, title: a.title })))} baseUrl={baseUrl} />

        <section aria-labelledby="publishers-title" className="space-y-3">
          <h2 id="publishers-title" className="font-display text-xl font-extrabold tracking-tight text-ink">
            Publishers behind the booth
          </h2>
          {publishers.map((p) => {
            const e = earned.get(p.id);
            return (
              <article key={p.id} className="rounded-card border border-line bg-card p-5">
                <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h3 className="font-display text-lg font-semibold tracking-tight text-ink">{p.name}</h3>
                  {e ? <MoneyTag money={e.total} label={`earned (${e.fetches} paid)`} tone="green" /> : null}
                </header>
                {p.blurb ? <p className="mt-1 text-sm text-ink-soft">{p.blurb}</p> : null}
                <ul className="mt-3 divide-y divide-line border-t border-line">
                  {p.articles.map((a) => (
                    <li key={a.id} className="flex items-baseline justify-between gap-x-4 py-2.5">
                      <span className="min-w-0 text-sm text-ink">
                        <span className="mr-2 font-mono text-xs text-ink-faint">{a.id}</span>
                        {a.title}
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="text-sm font-semibold tabular-nums text-ink">{formatMoney(a.price)}</span>
                        <span className={`block text-xs ${a.overCap ? "font-semibold text-stamp-red" : "text-ink-faint"}`}>
                          {a.overCap ? `over the ${formatMoney(defaults.cap)} default cap` : "per fetch"}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </section>
      </div>

      <section aria-labelledby="crawler-title" className="space-y-5">
        <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id="crawler-title" className="font-display text-2xl font-extrabold tracking-tight text-ink">
            The research agent
          </h2>
          {run ? <p className="font-mono text-xs text-ink-faint">{run.id}</p> : null}
        </header>

        {finished ? (
          <form onSubmit={onSubmit} className="grid grid-cols-[minmax(0,1fr)] gap-4 rounded-card border border-line bg-card p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
            <label className="block text-sm text-ink">
              <span className="block text-sm font-semibold text-ink">Research question</span>
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                rows={2}
                required
                minLength={3}
                maxLength={500}
                className="field mt-1.5 block w-full px-4 py-2.5 text-base text-ink"
              />
            </label>
            <label className="block text-sm text-ink">
              <span className="block text-sm font-semibold text-ink">Toll slip, in your words</span>
              <textarea
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                rows={2}
                required
                minLength={3}
                maxLength={500}
                className="field mt-1.5 block w-full px-4 py-2.5 text-base text-ink"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex h-11 items-center justify-center rounded-pill bg-ink px-6 text-sm font-semibold text-on-night transition-colors duration-[120ms] hover:bg-pp-deep focus-visible:outline-offset-4 active:bg-night-3 disabled:cursor-not-allowed disabled:opacity-55"
            >
              {run ? "Start another run" : "Write the toll slip"}
            </button>
            {startError ? (
              <p role="alert" className="text-sm text-stamp-red md:col-span-3">
                {startError}
              </p>
            ) : null}
          </form>
        ) : null}

        {runError ? (
          <p role="alert" className="text-sm text-stamp-red">
            {runError}
          </p>
        ) : null}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start">
        {slip || network ? (
          <div aria-label="Slips" role="group" className="order-2 min-w-0 space-y-6 lg:order-1">
            {slip ? <SlipCard slip={slip} title="Toll slip" /> : null}
            {network ? <SlipCard slip={network} title="Network payout slip" /> : null}
          </div>
        ) : null}
        <div className="order-1 min-w-0 space-y-5 lg:order-2">
        {run ? <WaitPanel run={run} onResume={onResume} /> : null}

        {run ? (
          <>
            <div className="on-night rounded-2xl bg-night p-5 text-on-night sm:p-6">
              <dl className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Live counters">
                <Counter label="Paid fetches">{counters.paid}</Counter>
                <Counter label="Refused (402)">{counters.refused}</Counter>
                <Counter label="Spent">{formatMoney(spent)}</Counter>
                <Counter label="Remaining">{formatMoney(remaining)}</Counter>
              </dl>
              <div className="mt-6">
                <div aria-hidden="true" className="relative h-3 overflow-hidden rounded-pill bg-night-3">
                  <div className="h-full origin-left rounded-pill bg-pp-sky transition-transform duration-[220ms] ease-out" style={{ transform: `scaleX(${spentShare})` }} />
                  {capShare > 0 && capShare < 1 ? <div className="absolute inset-y-0 w-0.5 bg-on-night" style={{ left: `${capShare * 100}%` }} /> : null}
                </div>
                {slip ? (
                  <p className="mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-on-night-soft">
                    <span>
                      Per-article cap <span className="font-semibold tabular-nums text-on-night">{formatMoney(defaults.cap)}</span>
                    </span>
                    <span>
                      Budget <span className="font-semibold tabular-nums text-on-night">{formatMoney(slip.budget)}</span>
                    </span>
                  </p>
                ) : null}
              </div>
            </div>

            <div>
              <h3 className="font-display text-lg font-semibold tracking-tight text-ink">Activity</h3>
              <ol aria-live="polite" aria-relevant="additions" aria-label="Crawler activity" className="mt-3 space-y-2">
                {counters.stamps.length === 0 ? (
                  <li className="rounded-md bg-paper-deep px-4 py-3 text-sm text-ink-soft">Each fetch gets a stamp here the moment the booth decides.</li>
                ) : (
                  counters.stamps.map((s) => <StampRow key={s.key} stamp={s} />)
                )}
              </ol>
            </div>
          </>
        ) : null}

        {run?.status === "failed" ? (
          <p role="alert" className="rounded-md border border-stamp-red bg-red-wash px-4 py-3 text-sm text-stamp-red">
            The run stopped: {run.error}
          </p>
        ) : null}
        {run?.status === "done" && state?.outcome ? (
          <p aria-live="polite" className="rounded-md bg-paper-deep px-4 py-3 text-base text-ink">
            {OUTCOME_WORDS[state.outcome] ?? state.outcome}
          </p>
        ) : null}

        {state?.answer ? (
          <article className="rounded-card border border-line bg-card p-6">
            <h3 className="font-display text-xl font-extrabold tracking-tight text-ink">The agent&apos;s answer</h3>
            <p className="mt-3 max-w-[68ch] text-base leading-relaxed text-ink">{state.answer}</p>
            {state.citations.length > 0 ? (
              <p className="mt-3 text-sm text-ink-soft">
                Paid sources:{" "}
                {state.citations.map((id, i) => (
                  <span key={id}>
                    {i > 0 ? ", " : ""}
                    <span className="font-mono text-xs">{id}</span> {titles.get(id) ? `"${titles.get(id)}"` : ""}
                  </span>
                ))}
              </p>
            ) : null}
            {state.needsNewSlip ? (
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-md bg-pp-gold-wash px-4 py-3">
                <p className="text-sm text-ink">
                  The agent stopped ({state.stopReason?.replace(/_/g, " ")}). It asks you to sign a new slip to keep reading.
                </p>
                <button
                  type="button"
                  disabled={busy || !finished}
                  onClick={() => void start({ question, intent })}
                  className="inline-flex h-11 items-center rounded-pill border border-edge px-5 text-sm font-semibold text-ink transition-colors duration-[120ms] hover:border-ink focus-visible:outline-offset-4 active:bg-paper-deep disabled:cursor-not-allowed disabled:opacity-55"
                >
                  Sign a new slip
                </button>
              </div>
            ) : null}
          </article>
        ) : null}

        {state && state.earnings.length > 0 ? (
          <div className="rounded-card border border-line bg-card p-6">
            <h3 className="font-display text-xl font-extrabold tracking-tight text-ink">Publisher split</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Earnings and payout weights per publisher</caption>
                <thead className="border-b border-ink text-sm text-ink-soft">
                  <tr>
                    <th className="py-2 pr-4 font-semibold">Publisher</th>
                    <th className="px-4 py-2 text-right font-semibold">Paid fetches</th>
                    <th className="px-4 py-2 text-right font-semibold">Earned</th>
                    <th className="py-2 pl-4 text-right font-semibold">Weight</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {state.earnings.map((e) => {
                    const w = state.splits.find((s) => s.payee === e.email)?.weightBps;
                    return (
                      <tr key={e.publisherId}>
                        <td className="py-2.5 pr-4 font-semibold text-ink">{e.name}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-ink">{e.fetches}</td>
                        <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">{formatMoney(e.total)}</td>
                        <td className="py-2.5 pl-4 text-right tabular-nums text-ink">{w !== undefined ? `${w} bps` : "pending"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        {slip || network ? (
          <div aria-label="Ledgers" role="group" className="space-y-6">
            {slip ? <LedgerTimeline slipId={slip.id} title="Toll slip ledger" /> : null}
            {network ? <LedgerTimeline slipId={network.id} title="Network slip ledger" /> : null}
          </div>
        ) : null}
        </div>
        </div>
      </section>
    </div>
  );
}

export default TollRoadView;
