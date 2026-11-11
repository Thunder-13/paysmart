"use client";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { EvidencePack, Run } from "@/core/contracts";
import { EvidencePackView } from "@/components/evidence-pack-view";
import { LedgerTimeline } from "@/components/ledger-timeline";
import { MoneyTag } from "@/components/money-tag";
import { fetchJson, resumeRun, startRun, useRun } from "@/components/run-client";
import { SlipBoard } from "@/components/slip-board";
import { SlipCard } from "@/components/slip-card";
import { defaultSelection, type Board, type BoardCard } from "@/pipelines/dispute-desk/board";
import type { ActDecision, ConfirmWaitData, DisputeDeskState } from "@/pipelines/dispute-desk/types";
import { chainStamp, decisionWords, outcomeAnnouncement, statusLabel, TONE_CLASSES } from "@/pipelines/dispute-desk/view";
import { BoardView, UrgencyChip } from "./board-view";
import { RecommendationCard } from "./recommendation-card";
import { ResponseEditor } from "./response-editor";

const STEP_WORDS: Record<string, string> = {
  load: "Reading the dispute from PayPal",
  link: "Finding the slip behind it",
  pack: "Verifying the hash-chained ledger",
  triage: "Weighing the evidence",
  draft: "Drafting the response",
  act: "Sending to PayPal",
};

const MECHANISM: { step: string; api: string | null }[] = [
  { step: "load", api: "rail.getDispute" },
  { step: "link", api: null },
  { step: "pack", api: null },
  { step: "triage", api: null },
  { step: "draft", api: null },
  { step: "act", api: "rail.provideEvidence, rail.acceptClaim" },
];

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The raw PayPal code in small mono type, allowed to wrap after each underscore. */
function RawStatus({ status }: { status: string }) {
  return (
    <span className="mt-0.5 block font-mono text-xs leading-tight text-ink-faint [overflow-wrap:anywhere]">
      {status.split("_").map((part, i) => (
        <Fragment key={i}>
          {i > 0 ? (
            <>
              _<wbr />
            </>
          ) : null}
          {part}
        </Fragment>
      ))}
    </span>
  );
}

function waitDataOf(run: Run<DisputeDeskState> | null): ConfirmWaitData | null {
  if (!run || run.status !== "waiting" || run.wait?.kind !== "user_confirm") return null;
  const d = run.wait.data;
  return d && typeof d === "object" && "suggestedDecision" in d ? (d as ConfirmWaitData) : null;
}

function DisputeFacts({ card }: { card: BoardCard }) {
  return (
    <section aria-labelledby="dispute-title" className="rounded-card border border-line bg-card p-6">
      <h2 id="dispute-title" className="font-display text-2xl font-extrabold tracking-tight text-ink">
        {card.reasonLabel}
      </h2>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 rounded-md bg-paper-deep p-4 text-sm sm:grid-cols-4">
        <div className="min-w-0">
          <dt className="text-xs text-ink-soft">Amount</dt>
          <dd className="mt-0.5 text-lg">
            <MoneyTag money={card.amount} />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-ink-soft">Status</dt>
          <dd className="mt-0.5 text-sm leading-snug text-ink" title={card.status}>
            {statusLabel(card.status)}
            <RawStatus status={card.status} />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-ink-soft">Response due</dt>
          <dd className="mt-0.5">
            <UrgencyChip card={card} />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-ink-soft">Transaction</dt>
          <dd className="mt-0.5 truncate font-mono text-xs text-ink">{card.transactionId ?? "none"}</dd>
        </div>
      </dl>
      <p className="mt-4 flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-3 text-xs text-ink-soft">
        <span>PayPal dispute</span>
        <span className="font-mono">{card.disputeId}</span>
        {card.buyerEmail ? <span>{card.buyerEmail}</span> : null}
      </p>
    </section>
  );
}

function BuyerWords({ messages, injection }: { messages: string[]; injection: boolean }) {
  if (messages.length === 0) return null;
  return (
    <figure className="rounded-card border border-dashed border-edge bg-card p-6">
      <figcaption className="text-sm font-semibold text-ink-soft">Buyer&apos;s words (untrusted, shown as data)</figcaption>
      {injection ? (
        <p className="mt-3 rounded-md bg-pp-gold-wash px-4 py-2.5 text-sm text-ink">
          A message contains instructions aimed at an AI. They were ignored.
        </p>
      ) : null}
      <div className="mt-3 space-y-3">
        {messages.map((m, i) => (
          <blockquote key={i} className="border-l-2 border-edge pl-4 text-base leading-relaxed text-ink-soft">
            {m}
          </blockquote>
        ))}
      </div>
    </figure>
  );
}

export interface DisputeDeskProps {
  initialBoard: Board;
  initialError?: string | null;
  /** From ?run=: open this run's dispute and show this exact run. */
  initialRun?: { runId: string; disputeId: string } | null;
}

export function DisputeDesk({ initialBoard, initialError = null, initialRun = null }: DisputeDeskProps) {
  const [board, setBoard] = useState(initialBoard);
  const [boardError, setBoardError] = useState<string | null>(initialError);
  const fromUrl = initialRun && initialBoard.lanes.some((l) => l.cards.some((c) => c.disputeId === initialRun.disputeId)) ? initialRun : null;
  const [selectedId, setSelectedId] = useState<string | null>(() => fromUrl?.disputeId ?? defaultSelection(initialBoard));
  const [started, setStarted] = useState<Record<string, string>>(() => (fromUrl ? { [fromUrl.disputeId]: fromUrl.runId } : {}));
  const [startError, setStartError] = useState<string | null>(null);
  const [focusSeq, setFocusSeq] = useState<number | undefined>(undefined);
  const [packs, setPacks] = useState<Record<string, EvidencePack>>({});

  const cards = useMemo(() => board.lanes.flatMap((l) => l.cards), [board]);
  const card = cards.find((c) => c.disputeId === selectedId) ?? null;
  const runId = card ? (started[card.disputeId] ?? card.case?.runId ?? null) : null;
  const { run: anyRun, slip, error: runError, refresh } = useRun(runId);
  const run = anyRun as Run<DisputeDeskState> | null;
  const state = run?.state ?? null;
  const waitData = waitDataOf(run);

  const refreshBoard = useCallback(async () => {
    try {
      const next = await fetchJson<Board>("/api/p/dispute-desk/disputes");
      setBoard(next);
      setBoardError(null);
    } catch (e) {
      setBoardError(msg(e));
    }
  }, []);

  // The board shows each case's decision and outcome; refresh it when the run settles.
  const settledKey = run && (run.status === "waiting" || run.status === "done") ? `${run.id}:${run.status}:${run.updatedAt}` : null;
  useEffect(() => {
    if (!settledKey) return;
    let cancelled = false;
    fetchJson<Board>("/api/p/dispute-desk/disputes")
      .then((next) => {
        if (cancelled) return;
        setBoard(next);
        setBoardError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setBoardError(msg(e));
      });
    return () => {
      cancelled = true;
    };
  }, [settledKey]);

  // Load the exact pack the recommendation was built from (pinned as a blob by the run).
  const packRef = state?.pack?.ref ?? null;
  useEffect(() => {
    if (!packRef || packs[packRef]) return;
    let cancelled = false;
    fetchJson<EvidencePack>(`/api/blobs/${encodeURIComponent(packRef)}`)
      .then((p) => {
        if (!cancelled) setPacks((prev) => ({ ...prev, [packRef]: p }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [packRef, packs]);
  const pack = packRef ? (packs[packRef] ?? null) : null;

  async function prepare(disputeId: string) {
    setStartError(null);
    try {
      const r = await startRun("dispute-desk", { disputeId });
      setStarted((s) => ({ ...s, [disputeId]: r.id }));
    } catch (e) {
      setStartError(msg(e));
    }
  }

  function select(c: BoardCard) {
    setSelectedId(c.disputeId);
    setFocusSeq(undefined);
    setStartError(null);
    if (c.status === "WAITING_FOR_SELLER_RESPONSE" && !c.case && !started[c.disputeId]) void prepare(c.disputeId);
  }

  function cite(seq: number) {
    setFocusSeq(undefined);
    requestAnimationFrame(() => setFocusSeq(seq));
  }

  async function submit(signal: { decision: ActDecision; notes: string }) {
    if (!run) return;
    await resumeRun(run.id, signal);
    await refresh();
  }

  const rec = state?.recommendation ?? null;
  const announcement = state?.outcome
    ? outcomeAnnouncement(state.outcome)
    : rec
      ? `Recommendation: ${decisionWords(rec.decision).word}, ${Math.round(rec.confidence * 100)}% confidence.`
      : run?.status === "failed"
        ? `The run failed: ${run.error ?? "unknown error"}`
        : "";
  const linkedSlipId = run?.slipId ?? null;
  const stamp = chainStamp(state?.pack ? { ok: state.pack.chainOk, brokenAtSeq: state.pack.brokenAtSeq, eventCount: state.pack.eventCount } : null);
  const canStartOver = card?.status === "WAITING_FOR_SELLER_RESPONSE" && (!run || run.status === "done" || run.status === "failed");

  return (
    <div>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <section aria-labelledby="board-title">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 id="board-title" className="font-display text-2xl font-extrabold tracking-tight text-ink">
            Deadline board
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-soft">
            <span className="tabular-nums">
              {board.total} dispute{board.total === 1 ? "" : "s"}
            </span>
            <span>{board.mode === "mock" ? "mock rail" : "PayPal sandbox"}</span>
            <button
              type="button"
              onClick={() => void refreshBoard()}
              className="inline-flex h-11 items-center rounded-pill border border-edge bg-card px-5 text-sm font-semibold text-ink transition-colors duration-[120ms] hover:border-ink focus-visible:outline-offset-4 active:bg-paper-deep"
            >
              Refresh
            </button>
          </div>
        </div>
        {boardError ? (
          <p role="alert" className="mb-2 text-sm text-stamp-red">
            Couldn&apos;t load the disputes: {boardError}
          </p>
        ) : null}
        <BoardView board={board} selectedId={selectedId} onSelect={select} />
      </section>

      {card ? (
        <div className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div className="space-y-6">
            <DisputeFacts card={card} />
            <BuyerWords messages={card.messages} injection={Boolean(state?.claim?.injectionSuspected)} />

            {slip ? (
              <SlipCard slip={slip} title="The slip behind this payment" />
            ) : (
              <section className="rounded-card border border-dashed border-edge bg-card p-6 text-sm text-ink-soft" aria-label="Linked slip">
                {state?.link && !state.link.slipId
                  ? `No slip found for transaction ${card.transactionId ?? "(none)"}.`
                  : card.link.slipId
                    ? `Slip ${card.link.slipId} is linked. Prepare a response to load its evidence.`
                    : `No slip found for transaction ${card.transactionId ?? "(none)"}.`}
              </section>
            )}

            {state?.pack ? (
              <p className={`inline-flex rounded-pill border px-3.5 py-1 text-sm font-semibold ${TONE_CLASSES[stamp.tone].border} ${TONE_CLASSES[stamp.tone].text} ${TONE_CLASSES[stamp.tone].wash}`}>
                {stamp.text}
              </p>
            ) : null}
            {pack ? <EvidencePackView pack={pack} /> : null}
            {linkedSlipId ? <LedgerTimeline slipId={linkedSlipId} focusSeq={focusSeq} title="Slip ledger" /> : null}
          </div>

          <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            {startError ? (
              <p role="alert" className="text-sm text-stamp-red">
                Couldn&apos;t start: {startError}
              </p>
            ) : null}
            {runError ? (
              <p role="alert" className="text-sm text-stamp-red">
                {runError}
              </p>
            ) : null}

            {run && run.status === "running" ? (
              <p aria-busy="true" className="rounded-md bg-paper-deep px-4 py-3 text-sm text-ink-soft">
                {STEP_WORDS[run.step] ?? "Working"}…
              </p>
            ) : null}
            {run?.status === "failed" ? (
              <p role="alert" className="rounded-md border border-stamp-red bg-red-wash px-4 py-3 text-sm text-stamp-red">
                {run.error}
              </p>
            ) : null}

            {state && state.warnings.length > 0 ? (
              <ul className="space-y-1" aria-label="Notes from this run">
                {state.warnings.map((w) => (
                  <li key={w} className="rounded-md bg-pp-gold-wash px-4 py-2.5 text-sm text-ink">
                    {w}
                  </li>
                ))}
              </ul>
            ) : null}

            {rec ? <RecommendationCard rec={rec} clauses={pack?.slip.clauses ?? slip?.clauses ?? []} onCite={cite} /> : null}

            <SlipBoard slipId={linkedSlipId} limit={4} />

            {run && waitData ? <ResponseEditor key={`${run.id}:${run.updatedAt}`} data={waitData} onSubmit={submit} /> : null}

            {state?.outcome ? (
              <section aria-label="Outcome" className="rounded-card border border-line bg-card p-5">
                <h3 className="font-display text-lg font-extrabold tracking-tight text-ink">Outcome</h3>
                <p className="mt-1.5 text-base text-ink">{outcomeAnnouncement(state.outcome)}</p>
                {state.outcome.kind === "not_actionable" || state.outcome.kind === "held" ? <p className="mt-1 text-sm text-ink-soft">{state.outcome.message}</p> : null}
              </section>
            ) : null}

            {canStartOver ? (
              <button
                type="button"
                onClick={() => void prepare(card.disputeId)}
                className="inline-flex h-11 items-center rounded-pill bg-ink px-6 text-sm font-semibold text-on-night transition-colors duration-[120ms] hover:bg-pp-deep focus-visible:outline-offset-4 active:bg-night-3 disabled:cursor-not-allowed disabled:opacity-55"
              >
                {run ? "Prepare a new response" : "Prepare response"}
              </button>
            ) : !run ? (
              <p className="text-sm text-ink-soft">This dispute isn&apos;t waiting on you, so there&apos;s nothing to send.</p>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mt-8 space-y-6">
          <p className="text-sm text-ink-soft">No disputes yet.</p>
          <section aria-labelledby="dd-mechanism" className="space-y-4">
            <h2 id="dd-mechanism" className="font-display text-2xl font-extrabold tracking-tight text-ink">
              What runs on each dispute
            </h2>
            <ol className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {MECHANISM.map((m, i) => (
                <li key={m.step} className="min-w-0 rounded-card border border-line bg-card p-4">
                  <p className="flex items-baseline gap-x-3">
                    <span className="font-semibold tabular-nums text-ink-faint">{i + 1}</span>
                    <span className="font-mono text-sm text-ink">{m.step}</span>
                  </p>
                  <p className="mt-2 text-sm text-ink-soft">{STEP_WORDS[m.step]}.</p>
                  {m.api ? <p className="mt-2 break-words font-mono text-xs text-ink-faint">{m.api}</p> : null}
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </div>
  );
}
