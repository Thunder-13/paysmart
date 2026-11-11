"use client";
/** PaySmart console: ask box, then the run in flow order: request screen, what I understood, search lanes, activity, carts, pay, receipt, delivery, refund. */
import { useId, useState } from "react";
import { DictateButtonHidden } from "./dictate";
import { MoneyTag } from "@/components/money-tag";
import { resumeRun, startRun, useRun } from "@/components/run-client";
import { SlipCard } from "@/components/slip-card";
import { PAYSMART_EXAMPLES, type PaySmartState } from "@/pipelines/paysmart/types";
import {
  ActivityList,
  ChoosePanel,
  ClarifyPanel,
  DeliveryPanel,
  HandoffCard,
  DiscoveryBoard,
  QUIET,
  PRIMARY,
  Receipt,
  RefundPanel,
  RequestScreenStrip,
  SignPanel,
} from "./panels";
import { MAX_ASK, OUTCOME_TONE, askViaFor, chooseData, outcomeLine, signAmount, waitData, waitStage } from "./view";

export interface PaySmartModes {
  paypal: "sandbox" | "mock";
  ai: "anthropic" | "mock";
  catalog: "channel3" | "fixtures";
}

const TONE_CLASS = { good: "border-stamp-green", neutral: "border-ink", bad: "border-stamp-red" } as const;

export function PaySmartConsole({ initialRunId, initialAsk, modes }: { initialRunId: string | null; initialAsk: string; modes: PaySmartModes }) {
  const [runId, setRunId] = useState<string | null>(initialRunId);
  const [ask, setAsk] = useState(initialAsk);
  const [redTeam, setRedTeam] = useState(false);
  const [dictated, setDictated] = useState<string | null>(null);
  const [starting, setStarting] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const { run, slip, events, error, refresh } = useRun(runId);
  const askId = useId();
  const redId = useId();
  const state = (run?.state ?? null) as PaySmartState | null;
  const stage = waitStage(run);
  const d = waitData(run);

  async function start() {
    setStarting({ busy: true, error: null });
    try {
      const created = await startRun("paysmart", { ask: ask.trim(), redTeam, askVia: askViaFor(dictated, ask) });
      setRunId(created.id);
      window.history.replaceState(null, "", `/p/paysmart?run=${encodeURIComponent(created.id)}`);
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

  function newAsk() {
    setRunId(null);
    window.history.replaceState(null, "", "/p/paysmart");
  }

  const choose = stage === "choose" ? chooseData(d) : null;
  const problem = state?.problem ?? choose?.problem ?? (typeof d.problem === "string" ? d.problem : null);
  const waitMessage = run?.wait?.message ?? "";
  const waiting = run?.status === "waiting" && !!run.wait;
  /* A wait the page can render: the clarify, choose, delivery and refund stages, or a PayPal approval. */
  const knownStage =
    stage === "clarify" ||
    (stage === "choose" && !!choose) ||
    (stage === "sign" && run?.wait?.kind === "paypal_approval" && typeof d.approveUrl === "string") ||
    stage === "delivery" ||
    stage === "refund";
  const delivery = state?.delivery?.check.summary ?? (typeof d.summary === "string" ? d.summary : null);

  return (
    <div className="space-y-8">
      {!runId ? (
        <section className="rounded-card border border-line bg-card p-6 sm:p-8" aria-label="Ask PaySmart">
          <label htmlFor={askId} className="font-display text-2xl font-extrabold tracking-tight text-ink">
            What do you need?
          </label>
          <textarea
            id={askId}
            value={ask}
            maxLength={MAX_ASK}
            onChange={(e) => setAsk(e.target.value)}
            rows={3}
            className="field mt-3 min-h-40 w-full px-5 py-4 text-lg leading-relaxed text-ink"
          />
          <div className="mt-3">
            <DictateButtonHidden
              onText={(t) => {
                setAsk(t.slice(0, MAX_ASK));
                setDictated(t.slice(0, MAX_ASK));
              }}
            />
          </div>
          <div role="group" aria-label="Example asks" className="mt-3 flex flex-wrap gap-2">
            {PAYSMART_EXAMPLES.map((ex) => (
              <button
                key={ex.label}
                type="button"
                onClick={() => {
                  setAsk(ex.ask);
                  setDictated(null);
                }}
                aria-pressed={ask === ex.ask}
                className={`inline-flex h-11 items-center rounded-pill border px-4 text-sm font-semibold transition-colors duration-[120ms] ${ask === ex.ask ? "border-ink bg-ink text-on-night" : "border-edge bg-card text-ink hover:border-ink"}`}
              >
                {ex.label}
              </button>
            ))}
          </div>
          <div className="relative mt-6 flex items-start gap-3 rounded-md bg-paper-deep p-4 transition-colors duration-[120ms] hover:bg-line has-[:checked]:bg-pp-sky-wash">
            <input id={redId} type="checkbox" checked={redTeam} onChange={(e) => setRedTeam(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-pp-blue" aria-describedby={`${redId}-hint`} />
            <label htmlFor={redId} className="cursor-pointer text-base text-ink after:absolute after:inset-0 after:content-['']">
              <span className="font-semibold">Red team: plant a hijack listing</span>
              <span id={`${redId}-hint`} className="block text-sm text-ink-soft">
                Adds a listing with hidden orders for AI agents. Watch the screens rule it out.
              </span>
            </label>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-line pt-6">
            <button type="button" onClick={() => void start()} disabled={starting.busy || ask.trim().length < 5} className={PRIMARY}>
              {starting.busy ? "Starting…" : "Start"}
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
          <p className="min-w-0 text-base text-ink [overflow-wrap:anywhere]">
            <span className="text-sm font-semibold text-ink-soft">{state?.askVia === "voice" ? "You said: " : "Your ask: "}</span>
            <q>{state?.ask ?? ask}</q>
          </p>
          <button type="button" onClick={newAsk} className={QUIET}>
            Ask something else
          </button>
        </div>
      )}

      {runId ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <div className="space-y-6">
            {slip ? <SlipCard slip={slip} /> : state?.handoff ? null : <p className="text-sm text-ink-faint">The slip is written once your ask is understood.</p>}
            {state?.hold ? (
              <section className="rounded-card border border-line bg-card p-5" aria-label="Hold">
                <MoneyTag className="text-2xl" money={state.hold} label="PayPal hold (the cart you chose)" tone="amber" />
              </section>
            ) : null}
          </div>

          <div className="min-w-0 space-y-6">
            {error ? (
              <p role="alert" className="text-sm text-stamp-red">
                {error}
              </p>
            ) : null}

            {run?.status === "done" && state?.outcome ? (
              <p role="status" className={`border-l-4 py-1 pl-4 text-lg font-semibold text-ink ${TONE_CLASS[OUTCOME_TONE[state.outcome] ?? "neutral"]}`}>
                {outcomeLine(state.outcome, state.note)}
              </p>
            ) : null}
            {run?.status === "failed" ? (
              <p role="alert" className="rounded-md border border-stamp-red bg-red-wash px-4 py-3 text-sm text-stamp-red">
                The run stopped: {run.error}
              </p>
            ) : null}

            {state?.handoff ? <HandoffCard handoff={state.handoff} /> : null}
            {state?.requestScreen?.length ? <RequestScreenStrip results={state.requestScreen} /> : null}

            {/* Flow order: ask, request screen, a question if there is one, what I understood and the search lanes, activity, carts, pay, receipt, delivery, refund. */}
            {waiting && stage === "clarify" ? <ClarifyPanel key={run.updatedAt} message={waitMessage} problem={problem} onSend={send} /> : null}

            {state ? <DiscoveryBoard state={state} /> : null}
            <ActivityList events={events} running={run?.status === "running"} step={run?.step} />

            {waiting && stage === "choose" && choose ? (
              <ChoosePanel
                key={run.updatedAt}
                message={waitMessage}
                options={choose.options.length ? choose.options : (state?.options ?? [])}
                ruledOut={choose.options.length || choose.ruledOut.length ? choose.ruledOut : (state?.ruledOut ?? [])}
                clauses={choose.clauses ?? slip?.clauses ?? []}
                limit={choose.limit ?? state?.totals?.limit ?? null}
                problem={problem}
                defaultOptionId={state?.chosenOptionId ?? null}
                onSend={send}
              />
            ) : null}
            {waiting && stage === "sign" && run.wait?.kind === "paypal_approval" && typeof d.approveUrl === "string" ? (
              <SignPanel message={waitMessage} approveUrl={d.approveUrl} amount={signAmount(d, state?.hold ?? null)} />
            ) : null}
            {waiting && !knownStage ? (
              <p className="rounded-card border border-pp-gold bg-pp-gold-wash p-5 text-base text-ink" role="status">
                {waitMessage}
              </p>
            ) : null}

            {state ? <Receipt state={state} slipId={run?.slipId ?? null} /> : null}

            {waiting && stage === "delivery" ? <DeliveryPanel message={waitMessage} accept={typeof d.accept === "string" ? d.accept : "image/*"} onSend={send} /> : null}
            {waiting && stage === "refund" ? <RefundPanel message={waitMessage} summary={delivery} onSend={send} /> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default PaySmartConsole;
