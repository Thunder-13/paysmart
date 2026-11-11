"use client";
/**
 * Shop console: start form, then three columns. Left the slip (with helper slips nested), center
 * the agent's activity and whatever the run is waiting for, right the money and the ledger.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Clause, Money, Run, Slip } from "@/core/contracts";
import { boardStrips } from "@/components/board-strips";
import { ClearanceBoard } from "@/components/clearance-board";
import { EvidencePackView } from "@/components/evidence-pack-view";
import { LedgerTimeline } from "@/components/ledger-timeline";
import { MoneyTag } from "@/components/money-tag";
import { fetchJson, resumeRun, startRun, useRun } from "@/components/run-client";
import { SignWithPayPal } from "@/components/sign-with-paypal";
import { slipFigures } from "@/components/slip-figures";
import { SlipCard } from "@/components/slip-card";
import { WaitPanel } from "@/components/wait-panel";
import { activityFromEvents, latestVerdict } from "@/pipelines/shop/activity";
import type { CartLine, HelperRecord, RuledOut, ShopState } from "@/pipelines/shop/types";
import { cartUtterance, optionsUtterances, slipUtterances, verdictUtterance } from "@/pipelines/shop/voice";
import { ActivityStream } from "./activity-stream";
import { CartPanel, CommissionLine, DeliveryPanel, SlipReviewPanel, type OptionView } from "./panels";
import { DictateButton, ReadAloudControls, speak } from "./voice-controls";

/**
 * One LedgerTimeline per slip. Below lg it sits in a closed details element; from lg up the details
 * is forced open and its summary hidden, so the side column reads as a plain panel.
 */
function LedgerDisclosure({ slipId, count }: { slipId: string; count: number }) {
  const [wide, setWide] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 64rem)");
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return (
    <details
      open={wide || open}
      onToggle={(e) => {
        if (!wide) setOpen(e.currentTarget.open);
      }}
      className="group rounded-card border border-line bg-card lg:border-0 lg:bg-transparent"
    >
      <summary className="flex min-h-11 cursor-pointer items-center px-5 font-display text-lg font-extrabold text-ink transition-colors duration-[120ms] hover:text-pp-blue active:text-pp-deep lg:hidden">
        Ledger ({count} {count === 1 ? "event" : "events"})
      </summary>
      <LedgerTimeline slipId={slipId} className="border-0 lg:border" />
    </details>
  );
}

export interface ShopModes {
  paypal: "sandbox" | "mock";
  ai: "anthropic" | "mock";
  catalog: "channel3" | "fixtures";
}

const OUTCOME_WORDS: Record<string, string> = {
  settled: "Settled. The gift is paid for and the rest of the hold went back.",
  refunded: "Refunded. The delivery broke the slip, so the goods came back off your bill.",
  cancelled: "Cancelled. Nothing was charged.",
  no_cart: "No cart fit the slip. The hold was voided.",
  blocked: "The guard blocked the cart at checkout. The hold was voided.",
  capture_failed: "PayPal refused the capture. The hold was voided.",
};

function dataOf(run: Run | null): Record<string, unknown> {
  const d = run?.wait?.data;
  return d && typeof d === "object" ? (d as Record<string, unknown>) : {};
}

function Toggle({ id, checked, onChange, label, hint }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <div className="relative flex items-start gap-3 rounded-md bg-paper-deep p-4 transition-colors duration-[120ms] hover:bg-line active:bg-line has-[:checked]:bg-pp-sky-wash">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-pp-blue" aria-describedby={`${id}-hint`} />
      <label htmlFor={id} className="cursor-pointer text-base text-ink after:absolute after:inset-0 after:content-['']">
        <span className="font-semibold">{label}</span>
        <span id={`${id}-hint`} className="block text-sm text-ink-soft">
          {hint}
        </span>
      </label>
    </div>
  );
}

export function ShopConsole({ initialRunId, demoIntent, modes }: { initialRunId: string | null; demoIntent: string; modes: ShopModes }) {
  const [runId, setRunId] = useState<string | null>(initialRunId);
  const [intent, setIntent] = useState(demoIntent);
  const [redTeam, setRedTeam] = useState(true);
  const [hireHelper, setHireHelper] = useState(false);
  const [readAloud, setReadAloud] = useState(false);
  const [starting, setStarting] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const { run, slip, events, error, refresh } = useRun(runId);
  const state = (run?.state ?? null) as ShopState | null;

  const cards = useMemo(() => activityFromEvents(events), [events]);
  const strips = useMemo(() => boardStrips(events, 6), [events]);
  const latest = latestVerdict(cards);
  const announcement = latest && slip ? verdictUtterance(latest.verdict, slip.clauses) : "";

  // Helper slips: refetched whenever helper events land or the run moves on.
  const slipId = slip?.id ?? null;
  const childKey = `${events.filter((e) => e.type.startsWith("shop.helper") || e.type === "child.created").length}:${run?.step ?? ""}:${run?.status ?? ""}`;
  const [children, setChildren] = useState<{ slipId: string | null; list: Slip[] }>({ slipId: null, list: [] });
  useEffect(() => {
    if (!slipId) return;
    let cancelled = false;
    fetchJson<Slip[]>(`/api/p/shop/children?slipId=${encodeURIComponent(slipId)}`)
      .then((list) => {
        if (!cancelled) setChildren({ slipId, list });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [slipId, childKey]);
  const childSlips = children.slipId === slipId ? children.list : [];

  // Read-aloud: each new verdict once, the slip when it is up for review, the cart when it waits.
  const spoken = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!readAloud || !slip) return;
    const lines: string[] = [];
    if (latest && !spoken.current.has(latest.key)) {
      spoken.current.add(latest.key);
      lines.push(verdictUtterance(latest.verdict, slip.clauses));
    }
    if (run?.status === "waiting") {
      const waitKey = `${run.id}:${run.step}:${run.updatedAt}`;
      if (!spoken.current.has(waitKey)) {
        spoken.current.add(waitKey);
        const d = dataOf(run);
        if (run.step === "confirm_slip") lines.push(...slipUtterances(typeof d.summary === "string" ? d.summary : null, slip.clauses));
        if (run.step === "confirm_cart" && d.totals) {
          lines.push(...optionsUtterances((d.options as OptionView[]) ?? []));
          lines.push(cartUtterance((d.lines as CartLine[]) ?? [], d.totals as { capture: Money; release: Money }));
        }
      }
    }
    if (lines.length) speak(lines);
  }, [readAloud, latest, run, slip]);

  async function start() {
    setStarting({ busy: true, error: null });
    try {
      const created = await startRun("shop", { intent, redTeam, hireHelper });
      spoken.current = new Set();
      setRunId(created.id);
      window.history.replaceState(null, "", `/p/shop?run=${encodeURIComponent(created.id)}`);
      setStarting({ busy: false, error: null });
    } catch (e) {
      setStarting({ busy: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  async function send(signal: unknown) {
    if (!runId) return;
    await resumeRun(runId, signal);
    await refresh();
  }

  function newRun() {
    setRunId(null);
    window.history.replaceState(null, "", "/p/shop");
  }

  const figures = slip ? slipFigures(slip) : null;
  const d = dataOf(run);

  return (
    <div className="space-y-8">
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      {!runId ? (
        <section className="rounded-card border border-line bg-card p-6 sm:p-8" aria-label="Write a permission slip">
          <label htmlFor="shop-intent" className="font-display text-2xl font-extrabold tracking-tight text-ink">
            What may the agent buy?
          </label>
          <textarea
            id="shop-intent"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            rows={3}
            className="field mt-3 min-h-40 w-full px-5 py-4 text-lg leading-relaxed text-ink"
          />
          <div className="mt-3">
            <DictateButton onText={(t) => setIntent((cur) => (cur.trim() ? `${cur.trim()} ${t}` : t))} />
          </div>
          <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
            <Toggle id="shop-redteam" checked={redTeam} onChange={setRedTeam} label="Red-team mode" hint="Plants a listing with hidden orders for AI agents. Watch the guard stamp it." />
            <Toggle id="shop-helper" checked={hireHelper} onChange={setHireHelper} label="Hire a card writer" hint="The agent may hire a $3.00 helper on a child slip, paid only if its work passes." />
          </div>
          <div className="mt-4">
            <ReadAloudControls enabled={readAloud} onChange={setReadAloud} />
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-line pt-6">
            <button
              type="button"
              onClick={() => void start()}
              disabled={starting.busy || intent.trim().length < 5}
              className="inline-flex h-11 items-center rounded-pill bg-ink px-6 text-sm font-semibold text-on-night transition-colors duration-[120ms] hover:bg-pp-deep active:bg-night-3 disabled:cursor-not-allowed disabled:opacity-55"
            >
              {starting.busy ? "Writing the slip…" : "Write the slip"}
            </button>
            <span className="flex flex-wrap gap-x-3 text-xs text-ink-faint">
              <span>Rail: {modes.paypal === "sandbox" ? "sandbox" : "offline simulator"}</span>
              <span>AI: {modes.ai === "anthropic" ? "Claude" : "scripted"}</span>
              <span>Catalog: {modes.catalog === "channel3" ? "Channel3" : "sample data"}</span>
            </span>
          </div>
          {starting.error ? (
            <p role="alert" className="mt-3 text-sm text-stamp-red">
              {starting.error}
            </p>
          ) : null}
        </section>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
          <ReadAloudControls
            enabled={readAloud}
            onChange={setReadAloud}
            onReadSlip={slip ? () => speak(slipUtterances(typeof slip.meta.summary === "string" ? slip.meta.summary : null, slip.clauses)) : undefined}
          />
          <button type="button" onClick={newRun} className="inline-flex h-11 items-center whitespace-nowrap rounded-pill border border-edge px-5 text-sm font-semibold text-ink transition-colors duration-[120ms] hover:border-ink active:bg-paper-deep disabled:cursor-not-allowed disabled:opacity-55">
            Start a new slip
          </button>
        </div>
      )}

      {runId && strips.length > 0 ? (
        <div>
          <ClearanceBoard variant="band" strips={strips} caption="The guard’s calls on this slip, live from its ledger." />
        </div>
      ) : null}

      {runId ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)_minmax(0,19rem)]">
          <div className="space-y-6">
            {slip ? <SlipCard slip={slip} childSlips={childSlips} /> : <p className="text-sm text-ink-faint">Writing your slip…</p>}
          </div>

          <div className="min-w-0 space-y-6">
            <h2 className="border-b border-line pb-3 font-display text-xl font-extrabold tracking-tight text-ink">Agent activity</h2>
            <ActivityStream cards={cards} />
            {error ? (
              <p role="alert" className="text-sm text-stamp-red">
                {error}
              </p>
            ) : null}
            {run?.status === "running" ? (
              <p className="text-sm text-ink-soft" role="status">
                Working…
              </p>
            ) : null}
            {run?.status === "waiting" && run.wait ? (
              run.step === "confirm_slip" ? (
                <SlipReviewPanel key={run.updatedAt} message={run.wait.message} clauses={(d.clauses as Clause[]) ?? slip?.clauses ?? []} onSend={send} />
              ) : run.step === "complete_signing" && typeof d.approveUrl === "string" ? (
                <section className="rounded-card border border-pp-gold bg-pp-gold-wash p-5 sm:p-6" aria-label="Sign the slip">
                  <p className="text-sm font-semibold text-stamp-amber">Waiting for you</p>
                  <p className="mt-1 text-base text-ink">{run.wait.message}</p>
                  <div className="mt-4">
                    <SignWithPayPal approveUrl={d.approveUrl} sdk="v6" />
                  </div>
                </section>
              ) : run.step === "confirm_cart" && d.totals ? (
                <CartPanel
                  key={run.updatedAt}
                  message={run.wait.message}
                  options={(d.options as OptionView[]) ?? []}
                  ruledOut={(d.ruledOut as RuledOut[]) ?? []}
                  selectedOptionId={typeof d.selectedOptionId === "string" ? d.selectedOptionId : null}
                  clauseIds={slip?.clauses.map((c) => c.id) ?? []}
                  helper={(d.helper as HelperRecord | null) ?? null}
                  onSend={send}
                />
              ) : run.step === "verify_delivery" ? (
                <DeliveryPanel message={run.wait.message} accept={typeof d.accept === "string" ? d.accept : "image/*"} onSend={send} />
              ) : (
                <WaitPanel run={run} onResume={send} />
              )
            ) : null}
            {run?.status === "failed" ? (
              <p role="alert" className="rounded-md border border-stamp-red bg-red-wash px-4 py-3 text-sm text-stamp-red">
                The run stopped: {run.error}
              </p>
            ) : null}
            {run?.status === "done" && state?.outcome ? (
              <p className="border-l-4 border-ink py-1 pl-4 text-lg font-semibold text-ink">{OUTCOME_WORDS[state.outcome] ?? state.outcome}</p>
            ) : null}
            {state?.evidencePack ? <EvidencePackView pack={state.evidencePack} /> : null}
          </div>

          <div className="space-y-6">
            {figures ? (
              <section className="rounded-card border border-line bg-card p-5" aria-label="Money">
                <h2 className="font-display text-xl font-extrabold tracking-tight text-ink">Money</h2>
                <ul role="list" className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5">
                  <li><MoneyTag className="text-2xl" money={slip?.rail.authorizationId ? figures.budget : figures.held} label="Held at signing" tone="amber" /></li>
                  <li><MoneyTag className="text-2xl" money={figures.spent} label="Spent" /></li>
                  <li><MoneyTag className="text-2xl" money={figures.released} label="Released" tone="green" /></li>
                  <li><MoneyTag className="text-2xl" money={figures.refunded} label="Refunded" tone="muted" /></li>
                </ul>
                {state?.affiliate ? <CommissionLine affiliate={state.affiliate} /> : null}
              </section>
            ) : null}
            {slip ? <LedgerDisclosure slipId={slip.id} count={events.length} /> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default ShopConsole;
