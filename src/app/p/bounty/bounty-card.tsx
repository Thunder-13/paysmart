"use client";
import { useState, type FormEvent } from "react";
import { LedgerTimeline } from "@/components/ledger-timeline";
import { MoneyTag } from "@/components/money-tag";
import { resumeRun, startRun, useRun } from "@/components/run-client";
import { SignWithPayPal } from "@/components/sign-with-paypal";
import { SlipBoard } from "@/components/slip-board";
import { SlipCard } from "@/components/slip-card";
import { shortTime, statusWords } from "@/components/slip-figures";
import type { Money } from "@/core/contracts";
import { formatMoney, fromCents, money, subMoney, toCents } from "@/core/money";
import type { BoardEntry } from "@/pipelines/bounty/board";
import type { BountyStatus, ProofPhoto } from "@/pipelines/bounty/schema";
import { Checklist } from "./checklist";
import { ProofCapture } from "./proof-capture";
import { Receipt } from "./receipt";

const STATUS: Record<BountyStatus, { text: string; className: string }> = {
  funding: { text: "Taking pledges", className: "border-pp-gold bg-pp-gold-wash text-stamp-amber" },
  funded: { text: "Funded, open to claim", className: "border-pp-blue bg-pp-sky-wash text-pp-deep" },
  claimed: { text: "Claimed, waiting for proof", className: "border-pp-gold bg-pp-gold-wash text-stamp-amber" },
  verified: { text: "Verified, paying", className: "border-pp-blue bg-pp-sky-wash text-pp-deep" },
  paid: { text: "Paid", className: "border-stamp-green bg-green-wash text-stamp-green" },
  settle_failed: { text: "Settlement failed, refunded", className: "border-stamp-red bg-red-wash text-stamp-red" },
  payout_failed: { text: "Payout failed", className: "border-stamp-red bg-red-wash text-stamp-red" },
  refunded: { text: "Refunded", className: "border-edge text-ink-soft" },
  expired: { text: "Expired, holds voided", className: "border-line text-ink-faint" },
  cancelled: { text: "Cancelled, holds voided", className: "border-line text-ink-faint" },
};

const field = "field mt-1.5 block w-full px-4 py-2.5 text-base font-normal text-ink placeholder:text-ink-faint disabled:opacity-55";
const label = "block min-w-0 text-sm font-semibold text-ink";
const secondary =
  "inline-flex h-11 items-center justify-center whitespace-nowrap rounded-pill border border-edge bg-card px-5 text-sm font-semibold text-ink transition-colors duration-[120ms] hover:border-ink active:bg-paper-deep disabled:cursor-not-allowed disabled:opacity-55";
const destructive =
  "inline-flex h-11 items-center justify-center rounded-pill border border-stamp-red bg-card px-5 text-sm font-semibold text-stamp-red transition-colors duration-[120ms] hover:bg-red-wash active:bg-red-wash disabled:cursor-not-allowed disabled:opacity-55";
const textAction =
  "inline-flex min-h-11 items-center font-semibold text-pp-blue underline decoration-line underline-offset-4 transition-colors duration-[120ms] hover:decoration-pp-blue active:text-pp-deep disabled:cursor-not-allowed disabled:opacity-55";
const textDanger =
  "font-semibold text-stamp-red underline decoration-line underline-offset-4 transition-colors duration-[120ms] hover:decoration-stamp-red active:opacity-70 disabled:cursor-not-allowed disabled:opacity-55";

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function BackForm({ bountyId, remaining }: { bountyId: string; remaining: Money }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState(remaining.value);
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { run } = useRun(runId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const started = await startRun("bounty", {
        kind: "pledge",
        bountyId,
        backer: { name: name.trim(), email: email.trim() || null },
        amount: money(amount),
      });
      setRunId(started.id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const approveUrl =
    run?.status === "waiting" && run.wait?.kind === "paypal_approval" ? (run.wait.data as { approveUrl?: string } | undefined)?.approveUrl : undefined;
  if (approveUrl) {
    return (
      <div className="space-y-3 rounded-md border border-pp-gold bg-pp-gold-wash p-4" aria-live="polite">
        <p className="text-sm text-ink">{run?.wait?.message}</p>
        <SignWithPayPal approveUrl={approveUrl} label="Hold my pledge with PayPal" />
      </div>
    );
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="grid grid-cols-[minmax(0,1fr)] gap-x-3 gap-y-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem_auto] sm:items-end" aria-label="Back this bounty">
      <label className={label}>
        Your name
        <input required value={name} onChange={(e) => setName(e.target.value)} className={field} autoComplete="name" />
      </label>
      <label className={label}>
        Email (optional)
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} autoComplete="email" />
      </label>
      <label className={label}>
        Amount (USD)
        <input required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${field} tabular-nums`} />
      </label>
      <button type="submit" disabled={busy || (runId !== null && run?.status !== "failed")} className={secondary}>
        {busy || (runId && !run) || run?.status === "running" ? "Writing your slip…" : "Back it"}
      </button>
      <p className="text-xs text-ink-faint sm:col-span-4">PayPal holds your pledge. Nothing is charged unless the proof passes, and the hold is voided if it never does.</p>
      {run?.status === "failed" || error ? (
        <p role="alert" className="text-sm text-stamp-red sm:col-span-4">
          {error ?? run?.error}
        </p>
      ) : null}
    </form>
  );
}

function ClaimForm({ onClaim, disabled }: { onClaim: (name: string, email: string) => Promise<void>; disabled: boolean }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onClaim(name.trim(), email.trim());
      }}
      className="grid grid-cols-[minmax(0,1fr)] gap-x-3 gap-y-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
      aria-label="Claim this job"
    >
      <label className={label}>
        Your name
        <input required value={name} onChange={(e) => setName(e.target.value)} className={field} autoComplete="name" />
      </label>
      <label className={label}>
        PayPal email for the payout
        <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} autoComplete="email" />
      </label>
      <button type="submit" disabled={disabled} className={secondary}>
        Claim the job
      </button>
      <p className="text-xs text-ink-faint sm:col-span-3">Claiming adds a clause to the pool slip: it can pay only this email.</p>
    </form>
  );
}

export function BountyCard({ entry, highlight, onChanged }: { entry: BoardEntry; highlight: boolean; onChanged: () => void }) {
  const { bounty, funded, run, payoutSlip, pledges } = entry;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSlips, setShowSlips] = useState(highlight);
  const [confirmCancel, setConfirmCancel] = useState(false);

  async function send(signal: unknown) {
    if (!run) return;
    setBusy(true);
    setError(null);
    try {
      await resumeRun(run.id, signal);
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const rewardCents = toCents(bounty.reward);
  const fundedCents = Math.min(toCents(funded), rewardCents);
  const pct = rewardCents > 0 ? Math.round((fundedCents * 1000) / rewardCents) / 10 : 0;
  const waitingAt = run?.status === "waiting" ? run.step : null;
  const status = STATUS[bounty.status];
  const lastAttempt = bounty.attempts.length > 0 ? bounty.attempts[bounty.attempts.length - 1] : null;
  const fundedShown = fromCents(fundedCents, bounty.reward.currency);
  const remaining = subMoney(bounty.reward, fundedShown);
  const canCancel = ["funding", "funded", "claimed"].includes(bounty.status) && waitingAt !== null;

  const held = pledges.filter((p) => ["active", "settling", "settled"].includes(p.status));
  const complete = fundedCents >= rewardCents && rewardCents > 0;

  return (
    <article
      id={`bounty-${bounty.id}`}
      aria-labelledby={`bounty-title-${bounty.id}`}
      className={`rounded-card bg-card p-5 sm:p-6 ${highlight ? "border-2 border-pp-blue" : "border border-line"}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h2 id={`bounty-title-${bounty.id}`} className="font-display text-xl font-extrabold tracking-tight text-ink">
            {bounty.title}
          </h2>
          <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-faint">
            <span>Posted by {bounty.organizer.name}</span>
            <span>
              ends <time dateTime={bounty.deadline}>{shortTime(bounty.deadline)}</time>
            </span>
          </p>
        </div>
        <span className={`rounded-pill border px-2.5 py-0.5 text-xs font-semibold ${status.className}`}>{status.text}</span>
      </header>

      <div className="mt-5 rounded-md bg-paper-deep p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <MoneyTag money={funded} className="text-figure leading-none" />
          <MoneyTag money={bounty.reward} label="Reward" className="text-xl" />
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={rewardCents}
          aria-valuenow={fundedCents}
          aria-valuetext={`${formatMoney(fundedShown)} of ${formatMoney(bounty.reward)}`}
          aria-label={`${fundedShown.value} of ${bounty.reward.value} ${bounty.reward.currency} funded`}
          className="relative mt-4 h-3 w-full overflow-hidden rounded-pill bg-line"
        >
          <div
            className={`absolute inset-0 origin-left transition-transform duration-[220ms] motion-reduce:transition-none ${complete ? "bg-pp-sky" : "bg-pp-gold"}`}
            style={{ transform: `scaleX(${pct / 100})` }}
          />
        </div>
        <p className="mt-2 text-xs text-ink-soft">
          {formatMoney(funded)} of {formatMoney(bounty.reward)} held by {held.length} backer(s)
        </p>
        {held.length > 0 ? (
          <ul aria-label="Pledges" className="mt-3 space-y-2">
            {held.map((p) => (
              <li key={p.id} className="flex items-stretch overflow-hidden rounded-sm bg-paper">
                <span className={`flex w-24 shrink-0 items-center justify-center px-2 py-2 text-xs font-semibold text-night ${p.status === "settled" ? "bg-pp-sky" : "bg-pp-gold"}`}>
                  {statusWords(p.status)}
                </span>
                <span className="flex min-w-0 flex-1 items-center justify-between gap-x-3 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate text-ink">{p.principal.name}</span>
                  <MoneyTag money={p.budget} />
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <SlipBoard slipId={bounty.payoutSlipId} limit={4} className="mt-5" />

      <p className="mt-5 text-base text-ink">{bounty.description}</p>
      <div className="mt-4 rounded-md bg-paper-deep p-4 text-sm">
        <p className="font-semibold text-ink">What counts as done</p>
        <p className="mt-1 text-ink-soft">{bounty.rubric}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-soft marker:text-pp-blue">
          {bounty.checks.map((c) => (
            <li key={c.id}>{c.label}</li>
          ))}
        </ul>
      </div>

      <div className="mt-5 space-y-4">
        {run?.lastRejection ? (
          <p role="status" className="rounded-md border border-pp-gold bg-pp-gold-wash px-4 py-3 text-sm text-ink">
            {run.lastRejection}
          </p>
        ) : null}

        {bounty.status === "funding" ? <BackForm bountyId={bounty.id} remaining={remaining} /> : null}

        {bounty.status === "funded" && waitingAt === "claim" ? (
          <ClaimForm disabled={busy} onClaim={(workerName, workerEmail) => send({ event: "claim", workerName, workerEmail })} />
        ) : null}

        {bounty.status === "claimed" && waitingAt === "verify" ? (
          <div className="space-y-3">
            <p className="text-base text-ink">
              <span className="font-semibold">{bounty.claim?.workerName}</span> claimed this job. Take the before photo first, do the work, then the after photo.
            </p>
            <ProofCapture
              shots={bounty.shots}
              disabled={busy}
              onSubmit={async (proof: { before: ProofPhoto; after: ProofPhoto }) => {
                if (!run) return;
                await resumeRun(run.id, { event: "proof", ...proof });
                onChanged();
              }}
            />
          </div>
        ) : null}

        {bounty.status === "verified" ? <p className="text-sm text-ink-soft" aria-live="polite">Proof passed. Capturing pledges and sending the payout…</p> : null}

        {lastAttempt ? <Checklist attempt={lastAttempt} number={bounty.attempts.length} /> : null}

        {bounty.status === "payout_failed" && waitingAt === "settle" ? (
          <div className="rounded-md border-2 border-stamp-red bg-red-wash p-4" aria-live="polite">
            <p className="text-sm text-ink">The PayPal payout did not go through: {bounty.failure}</p>
            <div className="mt-3 flex flex-wrap gap-3">
              <button type="button" disabled={busy} onClick={() => void send({ event: "payout_retry" })} className={secondary}>
                Retry the PayPal payout
              </button>
              <button type="button" disabled={busy} onClick={() => void send({ event: "payout_refund" })} className={destructive}>
                Refund every backer
              </button>
            </div>
          </div>
        ) : null}

        {bounty.status === "paid" ? <Receipt bounty={bounty} /> : null}
        {bounty.failure && bounty.status !== "payout_failed" ? <p className="text-sm text-stamp-red">{bounty.failure}</p> : null}
        {run?.status === "failed" && run.error ? (
          <p role="alert" className="text-sm text-stamp-red">
            {run.error}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-stamp-red">
            {error}
          </p>
        ) : null}
      </div>

      <footer className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-4 text-sm">
        <button
          type="button"
          aria-expanded={showSlips}
          aria-controls={`bounty-slips-${bounty.id}`}
          onClick={() => setShowSlips((s) => !s)}
          className={`text-left ${textAction}`}
        >
          {showSlips ? "Hide slips and ledger" : `Show slips and ledger (${pledges.length + 1} slips)`}
        </button>
        {canCancel ? (
          confirmCancel ? (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-ink-soft">Void every hold?</span>
              <button type="button" disabled={busy} onClick={() => void send({ event: "cancel" })} className={textDanger}>
                Yes, cancel the bounty
              </button>
              <button type="button" onClick={() => setConfirmCancel(false)} className={textAction}>
                Keep it
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmCancel(true)} className={textDanger}>
              Cancel bounty
            </button>
          )
        ) : null}
      </footer>

      {showSlips ? (
        <div id={`bounty-slips-${bounty.id}`} className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            {payoutSlip ? <SlipCard slip={payoutSlip} title="Bounty pool slip" /> : null}
            {pledges.map((p) => (
              <SlipCard key={p.id} slip={p} title={`Pledge from ${p.principal.name}`} />
            ))}
          </div>
          <LedgerTimeline slipId={bounty.payoutSlipId} title="Bounty ledger" />
        </div>
      ) : null}
    </article>
  );
}

export default BountyCard;
