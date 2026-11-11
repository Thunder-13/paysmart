"use client";
import { useEffect, useId, useState, type FormEvent } from "react";
import type { Run, Verdict } from "@/core/contracts";
import { formatMoney, money } from "@/core/money";
import { FileDrop, type UploadedFile } from "@/components/file-drop";
import { LedgerTimeline } from "@/components/ledger-timeline";
import {
  fetchJson,
  resumeRun,
  startRun,
  useRun,
} from "@/components/run-client";
import { SlipBoard } from "@/components/slip-board";
import { SignWithPayPal } from "@/components/sign-with-paypal";
import { SlipCard } from "@/components/slip-card";
import { VerdictStamp } from "@/components/verdict-stamp";
import {
  FIXTURES,
  FIXTURE_IDS,
  type FixtureId,
} from "@/pipelines/second-look/fixtures";
import { markLines } from "@/pipelines/second-look/highlight";
import {
  BAND_WORDS,
  CARRIERS,
  TACTIC_LABELS,
  type RiskBand,
  type TacticId,
} from "@/pipelines/second-look/taxonomy";
import type {
  FamilyAlert,
  HandoffRecord,
  Outcome,
  SecondLookState,
  Tactic,
} from "@/pipelines/second-look/types";

const PAGE = "/p/second-look";

/** Low risk is sky (within), caution is gold (needs a call), high is red (real danger). */
const BAND_LOOK: Record<
  RiskBand,
  { text: string; bar: string; wash: string; border: string }
> = {
  low: {
    text: "text-ink",
    bar: "bg-pp-sky",
    wash: "bg-pp-sky-wash",
    border: "border-pp-sky",
  },
  caution: {
    text: "text-stamp-amber",
    bar: "bg-pp-gold",
    wash: "bg-pp-gold-wash",
    border: "border-pp-gold",
  },
  high: {
    text: "text-stamp-red",
    bar: "bg-stamp-red",
    wash: "bg-red-wash",
    border: "border-stamp-red",
  },
};

const OUTCOME_LOOK: Record<
  Outcome,
  { decision: Verdict["decision"]; word: string }
> = {
  protected_shipped: { decision: "within", word: "PROTECTED" },
  shipped_unconfirmed: { decision: "ask", word: "PAID, TRACKING UNCONFIRMED" },
  handed_off: { decision: "ask", word: "SENT TO DISPUTE DESK" },
  seller_refused: { decision: "outside", word: "WALK AWAY" },
  buyer_walked_away: { decision: "outside", word: "WALKED AWAY" },
  payee_blocked: { decision: "outside", word: "WRONG PAYEE, STOPPED" },
  blocked: { decision: "outside", word: "STOPPED" },
  payment_cancelled: { decision: "ask", word: "CANCELLED" },
};

const OUTCOME_WORDS: Record<Outcome, string> = {
  protected_shipped: "Paid the protected way, tracking attached.",
  shipped_unconfirmed: "Paid the protected way; tracking not confirmed.",
  handed_off: "Reported as never arrived.",
  seller_refused: "The seller refused a protected payment. Walk away.",
  buyer_walked_away: "You walked away. Nothing was paid.",
  payee_blocked: "Stopped: the seller asked to be paid at a different account.",
  blocked: "Stopped before any payment.",
  payment_cancelled: "Payment cancelled. Nothing moved.",
};

const MOTION =
  "transition-colors duration-[120ms] focus-visible:outline-offset-2";
const btn = {
  primary: `inline-flex h-11 items-center justify-center rounded-pill bg-ink px-6 text-sm font-semibold text-on-night ${MOTION} hover:bg-pp-deep active:bg-night-3 disabled:cursor-not-allowed disabled:opacity-55`,
  red: `inline-flex h-11 items-center justify-center rounded-pill border border-stamp-red bg-card px-5 text-sm font-semibold text-stamp-red ${MOTION} hover:bg-red-wash active:bg-red-wash disabled:cursor-not-allowed disabled:opacity-55`,
  quiet: `inline-flex h-11 items-center justify-center rounded-pill border border-edge bg-card px-5 text-sm font-semibold text-ink ${MOTION} hover:border-ink active:bg-paper-deep disabled:cursor-not-allowed disabled:opacity-55`,
};
const field =
  "field mt-1 w-full px-4 py-2.5 text-base text-ink disabled:cursor-not-allowed disabled:opacity-55";
const labelCls = "block text-sm font-semibold text-ink";
const link = `font-semibold text-pp-blue underline decoration-line underline-offset-4 ${MOTION} hover:decoration-pp-blue active:text-pp-deep disabled:cursor-not-allowed disabled:opacity-55`;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface SecondLookClientProps {
  initialRunId: string | null;
  sandboxSellerEmail: string | null;
  simulated: boolean;
  scriptedAI: boolean;
}

export function SecondLookClient({
  initialRunId,
  sandboxSellerEmail,
  simulated,
  scriptedAI,
}: SecondLookClientProps) {
  const [runId, setRunId] = useState<string | null>(initialRunId);
  const modeNote =
    simulated || scriptedAI
      ? `Demo mode: ${[simulated ? "simulated payments" : null, scriptedAI ? "scripted analysis" : null].filter(Boolean).join(", ")}.`
      : null;
  return (
    <div className="space-y-6">
      {modeNote ? (
        <p className="rounded-pill bg-paper-deep px-4 py-1.5 text-xs font-semibold text-ink-soft">
          {modeNote}
        </p>
      ) : null}
      {runId ? (
        <RunView
          runId={runId}
          onNew={() => {
            setRunId(null);
            window.history.replaceState(null, "", PAGE);
          }}
        />
      ) : (
        <CheckForm
          sandboxSellerEmail={sandboxSellerEmail}
          onStarted={(id) => {
            setRunId(id);
            window.history.replaceState(
              null,
              "",
              `${PAGE}?run=${encodeURIComponent(id)}`,
            );
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ form */

function CheckForm({
  sandboxSellerEmail,
  onStarted,
}: {
  sandboxSellerEmail: string | null;
  onStarted: (runId: string) => void;
}) {
  const id = useId();
  const [chatText, setChatText] = useState("");
  const [listingText, setListingText] = useState("");
  const [sellerEmail, setSellerEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [trustedContact, setTrustedContact] = useState("");
  const [shot, setShot] = useState<UploadedFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function loadSample(fid: FixtureId) {
    const f = FIXTURES[fid];
    setChatText(f.chatText);
    setListingText(f.listingText);
    setSellerEmail(sandboxSellerEmail ?? f.sellerEmail);
    setAmount(f.amount.value);
    setBuyerName((n) => n || "Alex");
    setTrustedContact((t) => t || "family@example.com");
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    let amountMoney;
    try {
      amountMoney = money(amount);
    } catch {
      setError("Enter the amount, for example 120.00.");
      return;
    }
    setBusy(true);
    try {
      const run = await startRun("second-look", {
        chatText: chatText.trim() || undefined,
        screenshotRef: shot?.ref,
        listingText,
        sellerEmail,
        amount: amountMoney,
        principal: { name: buyerName.trim() || "Buyer", email: null },
        trustedContactEmail: trustedContact.trim() || undefined,
      });
      onStarted(run.id);
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-6 rounded-card border border-line bg-card p-6 sm:p-8"
      aria-describedby={`${id}-intro`}
    >
      <div>
        <h2 className="font-display text-2xl font-extrabold tracking-tight text-ink">
          About to pay a stranger?
        </h2>
        <p
          id={`${id}-intro`}
          className="mt-2 max-w-[60ch] text-base text-ink-soft"
        >
          Paste the chat or drop a screenshot, add the listing, and take a
          second look before any money moves.
        </p>
        <div
          className="mt-4 flex flex-wrap gap-2"
          role="group"
          aria-label="Load a sample conversation"
        >
          {FIXTURE_IDS.map((fid) => (
            <button
              key={fid}
              type="button"
              className={btn.quiet}
              onClick={() => loadSample(fid)}
            >
              {FIXTURES[fid].label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
        <div>
          <label htmlFor={`${id}-chat`} className={labelCls}>
            Chat with the seller
          </label>
          <textarea
            id={`${id}-chat`}
            value={chatText}
            onChange={(e) => setChatText(e.target.value)}
            rows={9}
            className={field}
            placeholder="Paste the messages here"
          />
          <div className="mt-2">
            {shot ? (
              <p className="flex items-center gap-x-3 text-sm text-ink-soft">
                Screenshot attached.
                <button
                  type="button"
                  className={link}
                  onClick={() => setShot(null)}
                >
                  Remove
                </button>
              </p>
            ) : (
              <FileDrop
                accept="image/png,image/jpeg,image/webp,image/gif"
                label="Or drop a screenshot of the chat"
                onUploaded={(f) => setShot(f)}
              />
            )}
          </div>
        </div>
        <div>
          <label htmlFor={`${id}-listing`} className={labelCls}>
            Listing text
          </label>
          <textarea
            id={`${id}-listing`}
            value={listingText}
            onChange={(e) => setListingText(e.target.value)}
            rows={4}
            required
            className={field}
            placeholder="Title and description from the listing"
          />
          <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-seller`} className={labelCls}>
                Seller email
              </label>
              <input
                id={`${id}-seller`}
                type="email"
                required
                value={sellerEmail}
                onChange={(e) => setSellerEmail(e.target.value)}
                className={field}
                autoComplete="off"
              />
            </div>
            <div>
              <label htmlFor={`${id}-amount`} className={labelCls}>
                Amount (USD)
              </label>
              <input
                id={`${id}-amount`}
                inputMode="decimal"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={field}
                placeholder="120.00"
              />
            </div>
            <div>
              <label htmlFor={`${id}-name`} className={labelCls}>
                Your name
              </label>
              <input
                id={`${id}-name`}
                value={buyerName}
                onChange={(e) => setBuyerName(e.target.value)}
                className={field}
                autoComplete="given-name"
              />
            </div>
            <div>
              <label htmlFor={`${id}-family`} className={labelCls}>
                Trusted contact email{" "}
                <span className="font-normal text-ink-faint">(optional)</span>
              </label>
              <input
                id={`${id}-family`}
                type="email"
                value={trustedContact}
                onChange={(e) => setTrustedContact(e.target.value)}
                className={field}
                aria-describedby={`${id}-family-help`}
              />
              <p
                id={`${id}-family-help`}
                className="mt-1.5 text-xs text-ink-faint"
              >
                Gets the risk card in the family inbox when risk is high or the
                seller refuses.
              </p>
            </div>
          </div>
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-md bg-red-wash px-4 py-2.5 text-sm font-semibold text-stamp-red"
        >
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={busy} className={btn.primary}>
        {busy ? "Reading the chat…" : "Take a second look"}
      </button>
    </form>
  );
}

/* --------------------------------------------------------------- run view */

function RunView({ runId, onNew }: { runId: string; onNew: () => void }) {
  const { run, slip, error, refresh } = useRun(runId);
  const [busy, setBusy] = useState(false);
  const [actError, setActError] = useState<string | null>(null);
  const [focus, setFocus] = useState<TacticId | null>(null);

  if (!run) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <p className="text-sm text-ink-soft" aria-live="polite">
          {error ? `Could not load this check: ${error}` : "Loading…"}
        </p>
        <button type="button" className={btn.quiet} onClick={onNew}>
          Start a new check
        </button>
      </div>
    );
  }

  const state = run.state as unknown as SecondLookState;
  const analysis = state.analysis;

  async function act(signal: unknown) {
    setBusy(true);
    setActError(null);
    try {
      await resumeRun(runId, signal);
      await refresh();
    } catch (e) {
      setActError(message(e));
    } finally {
      setBusy(false);
    }
  }

  const announce = [
    analysis
      ? `Risk ${analysis.riskScore} out of 100, ${BAND_WORDS[analysis.band]}.`
      : run.status === "running"
        ? "Reading the chat."
        : "",
    state.outcome ? OUTCOME_WORDS[state.outcome] : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="space-y-6">
      <SlipBoard slipId={run.slipId ?? null} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 space-y-6">
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {announce}
          </p>
          {run.status === "running" && !analysis ? (
            <p className="rounded-pill bg-pp-sky-wash px-4 py-2 text-sm font-semibold text-ink motion-safe:animate-fade-in">
              Reading the chat…
            </p>
          ) : null}
          {run.status === "failed" ? (
            <p
              role="alert"
              className="rounded-md border border-stamp-red bg-red-wash px-4 py-3 text-sm font-semibold text-stamp-red"
            >
              {run.error}
            </p>
          ) : null}

          {analysis ? (
            <RiskCard analysis={analysis} focus={focus} onFocus={setFocus} />
          ) : null}

          {state.outcome ? <OutcomePanel run={run} state={state} /> : null}

          {run.status === "waiting" && run.wait ? (
            <ActionPanel run={run} state={state} busy={busy} onAct={act} />
          ) : null}
          {actError ? (
            <p
              role="alert"
              className="rounded-md bg-red-wash px-4 py-2.5 text-sm font-semibold text-stamp-red"
            >
              {actError}
            </p>
          ) : null}

          {analysis ? (
            <Conversation
              state={state}
              tactics={analysis.tactics}
              focus={focus}
            />
          ) : null}

          <button type="button" className={btn.quiet} onClick={onNew}>
            Start a new check
          </button>
        </div>

        <div className="min-w-0 space-y-6">
          {state.verdict &&
          state.outcome !== "payee_blocked" &&
          state.outcome !== "blocked" ? (
            <VerdictStamp
              verdict={state.verdict}
              label={
                state.verdict.violations.length === 0
                  ? "PAYEE CHECKED"
                  : undefined
              }
              caption={`Pre-payment check: only ${state.input.sellerEmail}, no more than ${formatMoney(state.input.amount)}.`}
            />
          ) : null}
          {slip ? <SlipCard slip={slip} title="Payment slip" /> : null}
          {state.input.trustedContactEmail ? (
            <FamilyInbox
              to={state.input.trustedContactEmail}
              version={run.updatedAt}
            />
          ) : null}
          {run.slipId ? <LedgerTimeline slipId={run.slipId} /> : null}
        </div>
      </div>
    </div>
  );
}

export function RiskCard({
  analysis,
  focus,
  onFocus,
}: {
  analysis: NonNullable<SecondLookState["analysis"]>;
  focus: TacticId | null;
  onFocus: (t: TacticId | null) => void;
}) {
  const look = BAND_LOOK[analysis.band];
  return (
    <section
      aria-label="Risk card"
      className={`rounded-card border-2 ${look.border} ${look.wash} p-6`}
    >
      <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
        <p
          className={`font-display text-5xl font-extrabold leading-none tabular-nums tracking-tight ${look.text}`}
        >
          {analysis.riskScore}
          <span className="text-lg font-semibold text-ink-soft">/100</span>
        </p>
        <p className={`text-lg font-semibold ${look.text}`}>
          {BAND_WORDS[analysis.band]}
        </p>
      </div>
      <div
        role="meter"
        aria-label="Scam risk"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={analysis.riskScore}
        aria-valuetext={`${analysis.riskScore} out of 100, ${BAND_WORDS[analysis.band]}`}
        className="mt-4 h-3 w-full overflow-hidden rounded-pill bg-paper-deep"
      >
        <div
          className={`h-full w-full origin-left ${look.bar} transition-transform duration-700`}
          style={{ transform: `scaleX(${analysis.riskScore / 100})` }}
        />
      </div>
      <h2 className="mt-5 font-display text-xl font-extrabold tracking-tight text-ink [overflow-wrap:anywhere]">
        {analysis.headline}
      </h2>
      <p className="mt-1.5 text-base text-ink [overflow-wrap:anywhere]">
        {analysis.explanation}
      </p>
      {analysis.tactics.length > 0 ? (
        <ul
          className="mt-4 flex flex-wrap gap-2"
          aria-label="Scam tactics found"
        >
          {analysis.tactics.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                aria-pressed={focus === t.id}
                onClick={() => onFocus(focus === t.id ? null : t.id)}
                title={t.why}
                className={`relative inline-flex min-h-8 items-center gap-x-2 rounded-pill border px-3 py-1.5 text-xs after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-[''] font-semibold ${MOTION} ${
                  focus === t.id
                    ? "border-ink bg-ink text-on-night hover:bg-pp-deep active:bg-night-3"
                    : "border-stamp-red text-stamp-red hover:bg-red-wash active:bg-red-wash"
                }`}
              >
                {TACTIC_LABELS[t.id]}
                <span className="font-normal">
                  {t.source === "model"
                    ? "AI"
                    : t.source === "rule"
                      ? "phrase"
                      : "both"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {analysis.notes.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {analysis.notes.map((n) => (
            <li
              key={n}
              className="rounded-md bg-pp-gold-wash px-4 py-2 text-sm text-ink"
            >
              {n}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** "Dana: hi" splits into the speaker and the words; anything else is a bare line. */
function splitSpeaker(text: string): { speaker: string | null; body: string } {
  const m = /^([^:\s][^:]{0,23}):\s+(\S.*)$/.exec(text);
  return m ? { speaker: m[1], body: m[2] } : { speaker: null, body: text };
}

/** Cuts a line into plain and quoted spans, so each tactic's exact quote is marked on its own. */
function quoteSpans(
  text: string,
  hits: Tactic[],
): { text: string; hit: TacticId | null }[] {
  const lower = text.toLowerCase();
  const found: { start: number; end: number; id: TacticId }[] = [];
  for (const t of hits) {
    const q = t.quote.trim().toLowerCase();
    const start = q === "" ? -1 : lower.indexOf(q);
    if (start >= 0) found.push({ start, end: start + q.length, id: t.id });
  }
  found.sort((a, b) => a.start - b.start);
  const out: { text: string; hit: TacticId | null }[] = [];
  let at = 0;
  for (const f of found) {
    if (f.start < at) continue;
    if (f.start > at) out.push({ text: text.slice(at, f.start), hit: null });
    out.push({ text: text.slice(f.start, f.end), hit: f.id });
    at = f.end;
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: null });
  // A line that only sits inside a longer quote has no span of its own: mark all of it.
  return found.length === 0 && hits.length > 0
    ? [{ text, hit: hits[0].id }]
    : out;
}

export function Conversation({
  state,
  tactics,
  focus,
}: {
  state: SecondLookState;
  tactics: Tactic[];
  focus: TacticId | null;
}) {
  const chat = state.input.chatText ?? state.analysis?.transcript ?? "";
  const blocks: { title: string; key: string; text: string }[] = [
    {
      title: state.input.chatText
        ? "The chat"
        : "The chat (read from your screenshot)",
      key: "chat",
      text: chat,
    },
    { title: "The listing", key: "listing", text: state.input.listingText },
  ];
  return (
    <section
      aria-label="Conversation with highlighted lines"
      className="space-y-6"
    >
      {blocks
        .filter((b) => b.text.trim() !== "")
        .map((b) => {
          const thread = b.key === "chat";
          return (
            <div key={b.key}>
              <h3 className="text-lg font-extrabold tracking-tight text-ink">
                {b.title}
              </h3>
              <ol
                className={`mt-2 flex flex-col rounded-card border border-line bg-card p-4 ${thread ? "gap-3" : "gap-2"}`}
              >
                {markLines(b.text, tactics).map((line) => {
                  const hit = line.tactics.length > 0;
                  const strong = focus !== null && line.tactics.includes(focus);
                  const { speaker, body } = thread
                    ? splitSpeaker(line.text)
                    : { speaker: null, body: line.text };
                  const mine =
                    thread &&
                    speaker !== null &&
                    /^(buyer|you|me)$/i.test(speaker);
                  const hitTactics = tactics.filter((t) =>
                    line.tactics.includes(t.id),
                  );
                  const spans = hit
                    ? quoteSpans(body, hitTactics)
                    : [{ text: body, hit: null }];
                  return (
                    <li
                      key={line.index}
                      className={`flex max-w-[88%] flex-col gap-1 leading-relaxed ${mine ? "items-end self-end" : "items-start self-start"}`}
                    >
                      {speaker ? (
                        <span className="px-1 text-xs font-semibold text-ink-faint">
                          {speaker}
                        </span>
                      ) : null}
                      <p
                        className={`rounded-lg px-4 py-2.5 text-base [overflow-wrap:anywhere] ${
                          thread
                            ? mine
                              ? "rounded-br-xs bg-pp-blue text-on-plate"
                              : "rounded-bl-xs bg-paper-deep text-ink"
                            : "bg-paper-deep text-ink"
                        } ${hit ? (strong ? "border-2 border-ink" : "border-2 border-stamp-red") : ""}`}
                      >
                        {spans.map((sp, i) =>
                          sp.hit ? (
                            <mark
                              key={i}
                              className={`rounded-xs px-1 font-semibold text-ink underline decoration-stamp-red decoration-2 underline-offset-4 ${strong ? "bg-pp-gold" : "bg-red-wash"}`}
                            >
                              {sp.text}
                            </mark>
                          ) : (
                            <span key={i}>{sp.text}</span>
                          ),
                        )}
                      </p>
                      {hit ? (
                        <span className="flex flex-wrap gap-1.5 px-1">
                          {line.tactics.map((t) => (
                            <span
                              key={t}
                              className="rounded-pill bg-stamp-red px-2.5 py-0.5 text-xs font-semibold text-on-plate"
                            >
                              {TACTIC_LABELS[t]}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </div>
          );
        })}
    </section>
  );
}

export function ActionPanel({
  run,
  state,
  busy,
  onAct,
}: {
  run: Run;
  state: SecondLookState;
  busy: boolean;
  onAct: (signal: unknown) => Promise<void>;
}) {
  const wait = run.wait!;
  const data = (wait.data ?? {}) as {
    event?: string;
    approveUrl?: string | null;
  };
  const notice =
    state.notice && state.notice === wait.message ? null : state.notice;
  return (
    <section
      aria-label="Next step"
      className="space-y-4 rounded-card border-2 border-pp-gold bg-pp-gold-wash p-6"
    >
      <h2 className="font-display text-xl font-extrabold tracking-tight text-ink">
        Next step
      </h2>
      <p className="text-base text-ink [overflow-wrap:anywhere]">
        {wait.message}
      </p>
      {notice ? (
        <p className="text-sm font-semibold text-stamp-red [overflow-wrap:anywhere]">
          {notice}
        </p>
      ) : null}

      {wait.kind === "user_confirm" ? (
        <>
          <HonestOffer text={state.honestOffer} />
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy}
              className={btn.primary}
              onClick={() => void onAct({ action: "send_offer" })}
            >
              Send the honest offer
            </button>
            <button
              type="button"
              disabled={busy}
              className={btn.red}
              onClick={() => void onAct({ action: "walk_away" })}
            >
              Walk away
            </button>
          </div>
        </>
      ) : null}

      {wait.kind === "external_event" && data.event === "seller_response" ? (
        <>
          <HonestOffer text={state.honestOffer} />
          <p className="text-xs text-ink-soft">
            Demo controls: tell us how the seller answered.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy}
              className="inline-flex h-11 items-center justify-center whitespace-nowrap rounded-pill bg-ink px-6 text-sm font-semibold text-on-night transition-colors duration-[120ms] hover:bg-pp-deep focus-visible:outline-offset-2 active:bg-night-3 disabled:cursor-not-allowed disabled:opacity-55"
              onClick={() => void onAct({ response: "accepted" })}
            >
              Seller accepted protected payment
            </button>
            <button
              type="button"
              disabled={busy}
              className={btn.red}
              onClick={() => void onAct({ response: "refused" })}
            >
              Seller refused
            </button>
          </div>
        </>
      ) : null}

      {wait.kind === "paypal_approval" &&
      typeof data.approveUrl === "string" ? (
        <SignWithPayPal approveUrl={data.approveUrl} />
      ) : null}

      {wait.kind === "external_event" && data.event === "shipment" ? (
        <TrackingForm busy={busy} onAct={onAct} />
      ) : null}
    </section>
  );
}

function HonestOffer({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <figure className="min-w-0 rounded-md border border-pp-sky bg-pp-sky-wash px-4 py-3">
      <figcaption className="text-sm font-semibold text-ink">
        Honest offer to send the seller
      </figcaption>
      <blockquote className="mt-1.5 px-1 text-base text-ink [overflow-wrap:anywhere]">
        {text}
      </blockquote>
      <button
        type="button"
        className={`${btn.quiet} mt-3`}
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
      >
        {copied ? "Copied" : "Copy message"}
      </button>
    </figure>
  );
}

function TrackingForm({
  busy,
  onAct,
}: {
  busy: boolean;
  onAct: (signal: unknown) => Promise<void>;
}) {
  const id = useId();
  const [trackingNumber, setTrackingNumber] = useState("");
  const [carrier, setCarrier] = useState<string>("USPS");
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void onAct({ event: "shipped", trackingNumber, carrier });
      }}
    >
      <p className="text-xs text-ink-soft">
        Demo controls: enter the tracking number the seller sent you.
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor={`${id}-num`} className={labelCls}>
            Tracking number
          </label>
          <input
            id={`${id}-num`}
            required
            value={trackingNumber}
            onChange={(e) => setTrackingNumber(e.target.value)}
            className={`${field} font-mono`}
            placeholder="9400100000000000000000"
          />
        </div>
        <div>
          <label htmlFor={`${id}-carrier`} className={labelCls}>
            Carrier
          </label>
          <select
            id={`${id}-carrier`}
            value={carrier}
            onChange={(e) => setCarrier(e.target.value)}
            className={field}
          >
            {CARRIERS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={busy} className={btn.primary}>
          Seller shipped
        </button>
      </div>
      <button
        type="button"
        disabled={busy}
        className={btn.red}
        onClick={() => void onAct({ event: "not_arrived" })}
      >
        Item never arrived
      </button>
    </form>
  );
}

export function OutcomePanel({
  run,
  state,
}: {
  run: Run;
  state: SecondLookState;
}) {
  const outcome = state.outcome!;
  const look = OUTCOME_LOOK[outcome];
  const verdict: Verdict =
    (outcome === "payee_blocked" || outcome === "blocked") && state.verdict
      ? state.verdict
      : {
          decision: look.decision,
          violations: [],
          unknowns: [],
          checkedAt: run.updatedAt,
        };
  const canHandOff = !!state.captureId && outcome !== "handed_off";
  return (
    <section aria-label="Result" className="space-y-4">
      <VerdictStamp
        verdict={verdict}
        label={look.word}
        caption={state.recommendation ?? undefined}
      />
      {canHandOff ? <HandoffControl runId={run.id} /> : null}
    </section>
  );
}

function HandoffControl({ runId }: { runId: string }) {
  const [record, setRecord] = useState<HandoffRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJson<HandoffRecord>(
      `/api/p/second-look/handoff?runId=${encodeURIComponent(runId)}`,
    ).then(
      (r) => {
        if (!cancelled) setRecord(r);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (record) {
    return (
      <p
        className="rounded-md bg-paper-deep px-4 py-3 text-sm text-ink"
        aria-live="polite"
      >
        Reported as never arrived. Dispute Desk has the evidence pack for
        capture <span className="font-mono">{record.captureId}</span>.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={busy}
        className={btn.red}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            setRecord(
              await fetchJson<HandoffRecord>("/api/p/second-look/handoff", {
                method: "POST",
                body: JSON.stringify({ runId }),
              }),
            );
          } catch (e) {
            setError(message(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Item never arrived
      </button>
      {error ? (
        <p role="alert" className="text-sm font-semibold text-stamp-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function FamilyInbox({ to, version }: { to: string; version: string }) {
  const [alerts, setAlerts] = useState<FamilyAlert[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJson<FamilyAlert[]>(
      `/api/p/second-look/alerts?to=${encodeURIComponent(to)}`,
    ).then(
      (list) => {
        if (!cancelled) setAlerts(list);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [to, version]);

  return (
    <section
      aria-label="Family inbox"
      className="rounded-card border border-line bg-card p-6"
    >
      <h2 className="flex flex-wrap items-center gap-x-3 gap-y-1 font-display text-xl font-extrabold tracking-tight text-ink">
        Family inbox
        <span className="min-w-0 text-sm font-normal text-ink-faint [overflow-wrap:anywhere]">
          {to}
        </span>
        {alerts && alerts.length > 0 ? (
          <span
            className="rounded-pill bg-stamp-red px-2.5 py-0.5 text-xs font-semibold text-on-plate"
          >
            {alerts.length}
            <span className="sr-only"> alerts</span>
          </span>
        ) : null}
      </h2>
      {!alerts || alerts.length === 0 ? (
        <p className="mt-3 text-sm text-ink-soft">
          No alerts. This inbox hears about high-risk chats and refused
          protected payments.
        </p>
      ) : (
        <ul
          className="mt-3 space-y-3 motion-safe:animate-fade-in"
          aria-live="polite"
        >
          {alerts.slice(0, 6).map((a) => (
            <li
              key={a.id}
              className={`rounded-md border px-4 py-3 text-sm ${BAND_LOOK[a.band].border} ${BAND_LOOK[a.band].wash}`}
            >
              <p className="font-semibold text-ink">
                {a.reason === "high_risk"
                  ? `${a.buyerName} is about to pay a risky seller`
                  : `A seller refused ${a.buyerName}'s protected payment`}
              </p>
              <p className="mt-0.5 flex flex-wrap items-baseline gap-x-3 text-xs text-ink-soft">
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {a.sellerEmail}
                </span>
                <data
                  value={`${a.amount.value} ${a.amount.currency}`}
                  className="text-sm font-semibold tabular-nums text-ink"
                >
                  {formatMoney(a.amount)}
                </data>
                <span>risk {a.riskScore}/100</span>
              </p>
              {a.tactics.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs text-ink">
                  {a.tactics.slice(0, 3).map((t) => (
                    <li key={t.id}>
                      <span className="font-semibold">{t.label}:</span>{" "}
                      <q className="[overflow-wrap:anywhere]">{t.quote}</q>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
