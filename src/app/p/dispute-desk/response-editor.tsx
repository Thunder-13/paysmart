"use client";
import { useId, useState } from "react";
import type { ActDecision, ConfirmWaitData } from "@/pipelines/dispute-desk/types";
import { noteState } from "@/pipelines/dispute-desk/view";

const BUTTONS: { decision: ActDecision; label: string }[] = [
  { decision: "contest", label: "Send evidence to PayPal" },
  { decision: "accept", label: "Accept claim on PayPal" },
  { decision: "hold", label: "Hold" },
];

/** Editable response for the user_confirm wait. Sends {decision, notes}; nothing reaches PayPal before a click. */
export function ResponseEditor({ data, onSubmit }: { data: ConfirmWaitData; onSubmit: (signal: { decision: ActDecision; notes: string }) => Promise<void> }) {
  const [notes, setNotes] = useState(data.notes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();
  const countId = useId();
  const sendable = noteState(notes, "contest");

  async function send(decision: ActDecision) {
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ decision, notes: decision === "hold" ? "" : notes });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <section aria-label="Your response" className="rounded-card border-2 border-pp-gold bg-pp-gold-wash p-6">
      <p className="inline-block rounded-pill bg-pp-gold px-3 py-0.5 text-sm font-semibold text-night">Waiting for you</p>
      <p className="mt-3 text-base text-ink">Nothing goes to PayPal until you pick one of the buttons below.</p>

      {data.error ? (
        <p role="alert" className="mt-4 rounded-md border border-stamp-red bg-red-wash px-4 py-3 text-sm text-stamp-red">
          {data.error}
        </p>
      ) : null}

      <label htmlFor={fieldId} className="mt-5 block text-sm font-semibold text-ink">
        Response notes
      </label>
      <textarea
        id={fieldId}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        aria-describedby={countId}
        rows={10}
        className="field mt-1.5 block w-full resize-y px-5 py-4 font-sans text-base leading-7 text-ink"
      />
      <p id={countId} className={`mt-1.5 text-right text-sm tabular-nums ${sendable.over || sendable.empty ? "font-semibold text-stamp-red" : "text-ink-soft"}`}>
        {sendable.label}
      </p>

      {data.documents.length > 0 ? (
        <div className="mt-3">
          <p className="text-sm font-semibold text-ink-soft">Attached with evidence</p>
          <ul className="mt-1.5 space-y-1 text-xs text-ink-soft">
            {data.documents.map((d) => (
              <li key={d.name} className="flex flex-wrap gap-x-3">
                <span className="font-mono">{d.name}</span>
                <span className="tabular-nums">{(d.bytes / 1024).toFixed(1)} KB</span>
                <span>
                  sha256 <span className="font-mono">{d.sha256.slice(0, 12)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-3 text-sm text-ink-soft">No ledger documents will be attached; the notes go alone.</p>
      )}

      <div className="mt-5 flex flex-wrap gap-3">
        {BUTTONS.map(({ decision, label }) => {
          const recommended = decision === data.suggestedDecision;
          const disabled = busy || (decision !== "hold" && !sendable.canSend);
          return (
            <button
              key={decision}
              type="button"
              disabled={disabled}
              onClick={() => void send(decision)}
              className={`inline-flex h-11 items-center rounded-pill text-sm font-semibold transition-colors duration-[120ms] focus-visible:outline-offset-4 disabled:cursor-not-allowed disabled:opacity-55 ${
                recommended ? "bg-ink px-6 text-on-night hover:bg-pp-deep active:bg-night-3" : "border border-edge px-5 text-ink hover:border-ink active:bg-paper-deep"
              }`}
            >
              {label}
              {recommended ? <span className="ml-1.5 font-normal text-on-night-soft">(recommended)</span> : null}
            </button>
          );
        })}
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-stamp-red">
          {error}
        </p>
      ) : null}
    </section>
  );
}
