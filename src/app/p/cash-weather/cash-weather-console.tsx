"use client";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import type { Verdict } from "@/core/contracts";
import { formatMoney, money } from "@/core/money";
import { LedgerTimeline } from "@/components/ledger-timeline";
import { resumeRun, startRun, useRun } from "@/components/run-client";
import { SlipBoard } from "@/components/slip-board";
import { SlipCard } from "@/components/slip-card";
import { VerdictStamp } from "@/components/verdict-stamp";
import { WaitPanel } from "@/components/wait-panel";
import { DEFAULT_IMPORT_COUNTS, DEFAULT_PACKAGE_JSON } from "@/pipelines/cash-weather/fixtures";
import type { CashWeatherState, Notice, Outcome } from "@/pipelines/cash-weather/types";
import { DEFAULT_BALANCE, DEFAULT_BUFFER, DEFAULT_CAP, DEFAULT_SEED } from "@/pipelines/cash-weather/types";
import { BandChart } from "./band-chart";
import { InvoiceTable, type InvoiceDecision } from "./invoice-table";
import { GiveReasoning, UpstreamTable } from "./upstream-table";
import { WeatherStrip } from "./weather-strip";

const PAGE = "/p/cash-weather";

const OUTCOME: Record<Outcome, { decision: Verdict["decision"]; word: string; line: string }> = {
  paid: { decision: "within", word: "PAID", line: "Every maintainer was paid inside the slip." },
  blocked: { decision: "outside", word: "STOPPED", line: "The guard stopped the payout. Nobody was paid." },
  declined: { decision: "ask", word: "NOT THIS MONTH", line: "You declined the slip. Nothing was paid." },
  no_room: { decision: "ask", word: "NO ROOM TO GIVE", line: "The low case leaves no room above your buffer, so nothing is given this month." },
};

function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section aria-labelledby={id} className="space-y-4">
      <h2 id={id} className="font-display text-2xl font-extrabold tracking-tight text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function NoticeList({ notices }: { notices: Notice[] }) {
  if (notices.length === 0) return null;
  return (
    <ul className="space-y-2" aria-label="Data notices">
      {notices.map((n) => (
        <li
          key={n.id}
          data-notice={n.id}
          className={`rounded-md border px-4 py-3 text-sm ${n.level === "warn" ? "border-pp-gold bg-pp-gold-wash text-ink" : "border-line bg-card text-ink-soft"}`}
        >
          {n.level === "warn" ? <span className="mr-1 font-semibold text-stamp-amber">Heads up:</span> : null}
          {n.text}
        </li>
      ))}
    </ul>
  );
}

function StartForm({ onStarted }: { onStarted: (runId: string) => void }) {
  const id = useId();
  const [packageJson, setPackageJson] = useState(DEFAULT_PACKAGE_JSON);
  const [imports, setImports] = useState(JSON.stringify(DEFAULT_IMPORT_COUNTS, null, 2));
  const [balance, setBalance] = useState(DEFAULT_BALANCE);
  const [buffer, setBuffer] = useState(DEFAULT_BUFFER);
  const [cap, setCap] = useState(DEFAULT_CAP);
  const [seed, setSeed] = useState(String(DEFAULT_SEED));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const importCounts = imports.trim() === "" ? undefined : (JSON.parse(imports) as Record<string, number>);
      const run = await startRun("cash-weather", {
        packageJson,
        importCounts,
        currentBalance: money(balance),
        safetyBuffer: money(buffer),
        monthlyCap: money(cap),
        seed: Number.parseInt(seed, 10),
      });
      onStarted(run.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const field = "field mt-1 w-full px-4 py-2.5 text-base text-ink";
  return (
    <form onSubmit={submit} className="grid grid-cols-[minmax(0,1fr)] gap-6 rounded-card border border-line bg-card p-6 md:grid-cols-2" aria-label="Start a forecast">
      <div className="space-y-4">
        <p className="text-base text-ink-soft">
          Ana runs her studio on her own business account. Cash Weather reads 180 days of her PayPal history, forecasts 90 days, drafts reminders for late invoices, and works out how much she can safely give to the maintainers her code depends on.
        </p>
        {(
          [
            [`${id}-bal`, "Balance today (USD)", balance, setBalance],
            [`${id}-buf`, "Safety buffer (USD)", buffer, setBuffer],
            [`${id}-cap`, "Monthly giving cap (USD)", cap, setCap],
            [`${id}-seed`, "Scenario seed", seed, setSeed],
          ] as const
        ).map(([fid, label, value, set]) => (
          <div key={fid}>
            <label htmlFor={fid} className="block text-sm font-semibold text-ink">
              {label}
            </label>
            <input id={fid} inputMode="decimal" className={field} value={value} onChange={(e) => set(e.target.value)} required />
          </div>
        ))}
      </div>
      <div className="space-y-4">
        <div>
          <label htmlFor={`${id}-pkg`} className="block text-sm font-semibold text-ink">
            package.json
          </label>
          <textarea id={`${id}-pkg`} className={`${field} h-56 font-mono text-sm`} value={packageJson} onChange={(e) => setPackageJson(e.target.value)} spellCheck={false} />
        </div>
        <div>
          <label htmlFor={`${id}-imp`} className="block text-sm font-semibold text-ink">
            Import counts (optional hint, JSON)
          </label>
          <textarea id={`${id}-imp`} className={`${field} h-28 font-mono text-sm`} value={imports} onChange={(e) => setImports(e.target.value)} spellCheck={false} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 md:col-span-2">
        <button type="submit" disabled={busy} className="inline-flex h-11 items-center rounded-pill bg-ink px-6 text-sm font-semibold text-on-night transition-colors duration-[120ms] hover:bg-pp-deep active:bg-night-3 disabled:cursor-not-allowed disabled:opacity-55">
          {busy ? "Reading the books…" : "Forecast my cash"}
        </button>
        {error ? (
          <p role="alert" className="text-sm text-stamp-red">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}

const MECHANISM: { step: string; api: string | null; what: string }[] = [
  { step: "ingest", api: "rail.listTransactions, rail.listInvoices", what: "Reads 180 days of PayPal history and the open invoices." },
  { step: "forecast", api: null, what: "Runs the seeded scenarios and finds the weeks that run short." },
  { step: "upstream", api: "npm registry", what: "Finds the maintainers behind the dependencies in package.json." },
  { step: "budget", api: null, what: "Works out what can be given above the safety buffer, under the cap." },
  { step: "send_nudges", api: "rail.sendInvoiceReminder", what: "Waits for you to approve each late-invoice reminder." },
  { step: "pay", api: "rail.getPayout", what: "Pays inside the patronage slip once you confirm it, then checks the batch." },
];

function Mechanism() {
  return (
    <section aria-labelledby="cw-mechanism" className="space-y-4">
      <h2 id="cw-mechanism" className="font-display text-2xl font-extrabold tracking-tight text-ink">
        What runs when you forecast
      </h2>
      <ol className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {MECHANISM.map((m, i) => (
          <li key={m.step} className="min-w-0 rounded-card border border-line bg-card p-4">
            <p className="flex items-baseline gap-x-3">
              <span className="font-semibold tabular-nums text-ink-faint">{i + 1}</span>
              <span className="font-mono text-sm text-ink">{m.step}</span>
            </p>
            <p className="mt-2 text-sm text-ink-soft">{m.what}</p>
            {m.api ? <p className="mt-2 break-words font-mono text-xs text-ink-faint">{m.api}</p> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function RunView({ runId, onNew }: { runId: string; onNew: () => void }) {
  const { run, slip, error, refresh } = useRun(runId);
  if (!run) {
    return <p className="text-sm text-ink-soft">{error ? `Could not load the run: ${error}` : "Loading the run…"}</p>;
  }
  const s = run.state as unknown as CashWeatherState;
  const waitingReminders = run.status === "waiting" && run.step === "send_nudges";
  const waitingSlip = run.status === "waiting" && run.step === "pay";
  const resume = async (signal: unknown) => {
    await resumeRun(run.id, signal);
    await refresh();
  };
  const outcome = s.outcome ? OUTCOME[s.outcome] : null;
  const verdict = s.payout?.verdict ?? null;

  return (
    <div className="space-y-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p aria-live="polite" className="text-sm text-ink-soft">
          {run.status === "running" ? `Working: ${run.step.replace(/_/g, " ")}…` : null}
          {run.status === "waiting" ? (run.wait?.message ?? "Waiting for you") : null}
          {run.status === "done" ? "Done." : null}
          {run.status === "failed" ? <span className="text-stamp-red">Failed: {run.error}</span> : null}
        </p>
        <button type="button" onClick={onNew} className="inline-flex h-11 items-center rounded-pill border border-edge bg-card px-5 text-sm font-semibold text-ink transition-colors duration-[120ms] hover:border-ink active:bg-paper-deep disabled:cursor-not-allowed disabled:opacity-55">
          New forecast
        </button>
      </div>

      <NoticeList notices={s.notices} />

      {s.forecast ? (
        <Section title="Cash weather, next 13 weeks" id="cw-weather">
          <WeatherStrip weeks={s.forecast.weeks} />
          <BandChart forecast={s.forecast} />
          {s.narrative ? (
            <div className="rounded-card border border-line bg-card p-5">
              <p className="max-w-[48ch] text-xl font-semibold leading-snug tracking-tight text-ink">{s.narrative.forecast}</p>
              <ol className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3" aria-label="Top risks">
                {s.narrative.risks.map((r, i) => (
                  <li key={i} className="rounded-md bg-paper-deep p-4">
                    <p className="text-sm font-semibold text-ink">{r.title}</p>
                    <p className="mt-1 text-xs text-ink-soft">{r.detail}</p>
                    <p className="mt-2 text-xs font-semibold tabular-nums text-ink-faint">week {r.week}</p>
                  </li>
                ))}
              </ol>
              {s.narrative.source === "fallback" ? <p className="mt-3 text-xs text-stamp-amber">Written from the numbers by a template: the AI call failed.</p> : null}
            </div>
          ) : null}
        </Section>
      ) : null}

      {s.forecast ? (
        <Section title="Late invoices" id="cw-invoices">
          <InvoiceTable
            key={s.drafts.map((d) => d.invoiceId).join("|")}
            outlooks={s.forecast.invoices}
            drafts={s.drafts}
            reminders={s.reminders}
            waiting={waitingReminders}
            error={waitingReminders ? s.waitError : null}
            onSubmit={(decisions: InvoiceDecision[]) => resume({ decisions })}
          />
        </Section>
      ) : null}

      {s.upstream ? (
        <Section title="Pay who you depend on" id="cw-upstream">
          <UpstreamTable upstream={s.upstream} give={s.give} />
          {s.give ? <GiveReasoning give={s.give} /> : null}
        </Section>
      ) : null}

      {slip ? (
        <Section title="Patronage slip" id="cw-slip">
          <SlipCard slip={slip} title="Patronage slip" />
          {waitingSlip ? <WaitPanel run={run} onResume={resume} /> : null}
          {verdict ? <VerdictStamp verdict={verdict} caption={`Payout of ${formatMoney(slip.budget)} to ${s.give?.payouts.length ?? 0} maintainers`} /> : null}
          {outcome && !verdict ? <VerdictStamp verdict={{ decision: outcome.decision, violations: [], unknowns: [], checkedAt: run.updatedAt }} label={outcome.word} caption={outcome.line} /> : null}
          {s.payout?.payoutBatchId ? (
            <div className="rounded-card border border-line bg-card p-5 text-sm">
              <p className="text-ink">
                PayPal Payouts batch <span className="font-mono">{s.payout.payoutBatchId}</span>: <span className="font-semibold">{s.payout.status ?? "created"}</span>
              </p>
              <ul className="mt-3 space-y-1 font-mono text-xs text-ink-soft">
                {s.payout.items.map((i) => (
                  <li key={i.senderItemId}>
                    {i.senderItemId}: {i.status}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <SlipBoard slipId={slip.id} />
          <LedgerTimeline slipId={slip.id} title="Ledger" />
        </Section>
      ) : null}
    </div>
  );
}

export function CashWeatherConsole({ initialRunId, modeNote }: { initialRunId: string | null; modeNote: string | null }) {
  const [runId, setRunId] = useState<string | null>(initialRunId);
  return (
    <div className="space-y-8">
      {modeNote ? <p className="text-xs text-ink-faint">{modeNote}</p> : null}
      {runId ? (
        <RunView
          runId={runId}
          onNew={() => {
            setRunId(null);
            window.history.replaceState(null, "", PAGE);
          }}
        />
      ) : (
        <>
          <StartForm
            onStarted={(id) => {
              setRunId(id);
              window.history.replaceState(null, "", `${PAGE}?run=${encodeURIComponent(id)}`);
            }}
          />
          <Mechanism />
        </>
      )}
    </div>
  );
}

export default CashWeatherConsole;
