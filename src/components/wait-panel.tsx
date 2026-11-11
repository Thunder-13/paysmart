"use client";
import { useState } from "react";
import type { Run } from "@/core/contracts";
import { FileDrop } from "./file-drop";
import { SignWithPayPal } from "./sign-with-paypal";

export interface WaitPanelProps {
  run: Run;
  /** Called with the resume signal: {approved} for user_confirm, {ref, contentType} for user_upload. */
  onResume: (signal: unknown) => unknown | Promise<unknown>;
  className?: string;
}

function dataOf(run: Run): Record<string, unknown> {
  const d = run.wait?.data;
  return d && typeof d === "object" ? (d as Record<string, unknown>) : {};
}

/**
 * Renders what a waiting run needs from a person.
 *   paypal_approval  "Sign with PayPal" when wait.data.approveUrl is set
 *   user_confirm     Approve / Decline (labels from wait.data.confirmLabel / declineLabel)
 *   user_upload      FileDrop (accept from wait.data.accept, default "image/*")
 *   external_event   a waiting note
 */
export function WaitPanel({ run, onResume, className = "" }: WaitPanelProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (run.status !== "waiting" || !run.wait) return null;
  const wait = run.wait;
  const data = dataOf(run);

  async function send(signal: unknown) {
    setBusy(true);
    setError(null);
    try {
      await onResume(signal);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-live="polite" className={`relative overflow-hidden rounded-card border-2 border-pp-gold bg-pp-gold-wash p-5 pt-6 sm:p-6 sm:pt-7 ${className}`} aria-label="Waiting for you">
      <div aria-hidden="true" className="stamp-wait-track absolute inset-x-0 top-0">
        <span className="stamp-wait-bar bg-pp-gold" />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="stamp-wait-pulse rounded-pill bg-pp-gold px-3 py-0.5 text-sm font-semibold text-night">Waiting for you</span>
      </div>
      <p className="mt-3 text-lg font-semibold text-ink">{wait.message}</p>
      <div className="mt-4">
        {wait.kind === "paypal_approval" ? (
          typeof data.approveUrl === "string" ? (
            <SignWithPayPal approveUrl={data.approveUrl} />
          ) : (
            <p className="text-sm text-ink-soft">Finish signing in the PayPal window.</p>
          )
        ) : null}
        {wait.kind === "user_confirm" ? (
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void send({ approved: true })}
              className="inline-flex h-11 items-center rounded-pill bg-ink px-6 text-sm font-semibold text-on-night transition-colors duration-[120ms] hover:bg-pp-deep active:bg-night-3 disabled:cursor-not-allowed disabled:opacity-55"
            >
              {typeof data.confirmLabel === "string" ? data.confirmLabel : "Approve"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void send({ approved: false })}
              className="inline-flex h-11 items-center rounded-pill border border-stamp-red px-5 text-sm font-semibold text-stamp-red transition-colors duration-[120ms] hover:bg-red-wash active:bg-red-wash disabled:cursor-not-allowed disabled:opacity-55"
            >
              {typeof data.declineLabel === "string" ? data.declineLabel : "Decline"}
            </button>
          </div>
        ) : null}
        {wait.kind === "user_upload" ? (
          <FileDrop
            accept={typeof data.accept === "string" ? data.accept : "image/*"}
            disabled={busy}
            onUploaded={(f) => void send({ ref: f.ref, contentType: f.contentType })}
          />
        ) : null}
        {wait.kind === "external_event" ? <p className="text-sm text-ink-soft">This continues on its own when the event arrives.</p> : null}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-stamp-red">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export default WaitPanel;
