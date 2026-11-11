"use client";
import { useState, type FormEvent } from "react";
import { formatMoney, fromCents } from "@/core/money";
import type { InvoiceOutlook, ReminderDraft, ReminderOutcome, Tone } from "@/pipelines/cash-weather/types";

type Action = "approve" | "edit" | "skip";
export interface InvoiceDecision {
  invoiceId: string;
  action: Action;
  subject?: string;
  note?: string;
}

const TONE_LOOK: Record<Tone, string> = {
  friendly: "border-pp-blue bg-pp-sky-wash text-pp-deep",
  firm: "border-pp-gold bg-pp-gold-wash text-stamp-amber",
  final: "border-ink bg-card text-ink",
};

/** The holder colour on the strip's left: gold while it awaits clearance, then the outcome's colour. */
function holderLook(outcome: ReminderOutcome | undefined, waiting: boolean): { holder: string; ink: string; edge: string } {
  if (waiting || !outcome) return { holder: "bg-pp-gold", ink: "text-night", edge: "border-pp-gold" };
  if (outcome.status === "failed") return { holder: "bg-stamp-red", ink: "text-on-plate", edge: "border-stamp-red" };
  if (outcome.status === "skipped") return { holder: "bg-paper-deep", ink: "text-ink", edge: "border-line" };
  return { holder: "bg-pp-sky", ink: "text-night", edge: "border-pp-sky" };
}

const STATUS_WORDS: Record<ReminderOutcome["status"], string> = {
  sent: "Sent through PayPal",
  simulated: "Recorded (sample invoice, not sent)",
  skipped: "Skipped",
  failed: "PayPal refused it",
};

function likely(o: InvoiceOutlook | undefined): string {
  if (!o) return "";
  const pct = `${Math.round(o.pIn30 * 100)}% by day 30`;
  return o.medianPayDay === null ? `${pct}; may not pay within 90 days` : `${pct}; typical day ${o.medianPayDay}`;
}

export interface InvoiceTableProps {
  outlooks: InvoiceOutlook[];
  drafts: ReminderDraft[];
  reminders: ReminderOutcome[];
  /** True while the run waits for reminder decisions. */
  waiting: boolean;
  error: string | null;
  onSubmit?: (decisions: InvoiceDecision[]) => Promise<unknown>;
}

export function InvoiceTable({ outlooks, drafts, reminders, waiting, error, onSubmit }: InvoiceTableProps) {
  const [choice, setChoice] = useState<Record<string, Action>>(() => Object.fromEntries(drafts.map((d) => [d.invoiceId, "approve" as Action])));
  const [edits, setEdits] = useState<Record<string, { subject: string; note: string }>>(() =>
    Object.fromEntries(drafts.map((d) => [d.invoiceId, { subject: d.subject, note: d.note }])),
  );
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const draftById = new Map(drafts.map((d) => [d.invoiceId, d]));
  const outcomeById = new Map(reminders.map((r) => [r.invoiceId, r]));
  const notDrafted = outlooks.filter((o) => !draftById.has(o.invoiceId));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!onSubmit) return;
    setBusy(true);
    setLocalError(null);
    try {
      await onSubmit(
        drafts.map((d) => {
          const action = choice[d.invoiceId] ?? "approve";
          return action === "edit" ? { invoiceId: d.invoiceId, action, ...edits[d.invoiceId] } : { invoiceId: d.invoiceId, action };
        }),
      );
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const rows = drafts.map((d) => {
    const outlook = outlooks.find((o) => o.invoiceId === d.invoiceId);
    const outcome = outcomeById.get(d.invoiceId);
    const action = choice[d.invoiceId] ?? "approve";
    const look = holderLook(outcome, waiting);
    return (
      <li key={d.invoiceId} className={`grid grid-cols-[minmax(0,1fr)] overflow-hidden rounded-card border-2 bg-card sm:grid-cols-[minmax(11rem,auto)_minmax(0,1fr)] ${look.edge}`} data-invoice={d.invoiceId}>
        <div className={`flex flex-col justify-center gap-1 px-5 py-4 ${look.holder} ${look.ink}`}>
          <span className="font-mono text-sm font-semibold">{d.number}</span>
          <span className="font-display text-2xl font-extrabold tabular-nums tracking-tight">{formatMoney(d.amount)}</span>
          <span className="text-xs font-semibold">{d.daysOverdue} days overdue</span>
        </div>
        <div className="min-w-0 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <p className="text-base font-semibold text-ink">{d.payer}</p>
            <span className={`rounded-pill border px-2.5 py-0.5 text-xs font-semibold ${TONE_LOOK[d.tone]}`}>Tone: {d.tone}</span>
          </div>
          <p className="mt-1 text-xs text-ink-soft">Likely paid: {likely(outlook)}</p>
          {waiting && action === "edit" ? (
            <div className="mt-3 space-y-3">
              <label className="block text-sm font-semibold text-ink">
                Subject
                <input
                  className="field mt-1 w-full px-4 py-2.5 text-base font-normal"
                  maxLength={120}
                  value={edits[d.invoiceId]?.subject ?? ""}
                  onChange={(e) => setEdits((s) => ({ ...s, [d.invoiceId]: { ...s[d.invoiceId], subject: e.target.value } }))}
                />
              </label>
              <label className="block text-sm font-semibold text-ink">
                Note
                <textarea
                  className="field mt-1 h-36 w-full px-4 py-2.5 text-base font-normal"
                  maxLength={1000}
                  value={edits[d.invoiceId]?.note ?? ""}
                  onChange={(e) => setEdits((s) => ({ ...s, [d.invoiceId]: { ...s[d.invoiceId], note: e.target.value } }))}
                />
              </label>
            </div>
          ) : (
            <div className="mt-3 rounded-md bg-paper-deep px-4 py-3">
              <p className="text-sm font-semibold text-ink">{d.subject}</p>
              <p className="mt-1 whitespace-pre-line text-sm text-ink-soft">{d.note}</p>
              {d.templated ? <p className="mt-2 text-xs text-ink-faint">Template draft</p> : null}
            </div>
          )}
          {waiting ? (
            <fieldset className="mt-4 flex flex-wrap gap-2 text-sm">
              <legend className="sr-only">Reminder for invoice {d.number}</legend>
              {(["approve", "edit", "skip"] as const).map((a) => (
                <label
                  key={a}
                  className={`inline-flex h-11 cursor-pointer items-center gap-2 rounded-pill px-5 text-ink transition-colors duration-[120ms] active:bg-pp-sky has-[:checked]:bg-pp-sky-wash has-[:checked]:text-pp-deep ${
                    a === "approve" ? "bg-paper-deep font-extrabold hover:bg-pp-sky-wash" : "bg-paper-deep font-semibold hover:bg-line"
                  }`}
                >
                  <input type="radio" className="h-4 w-4 accent-pp-blue" name={`decision-${d.invoiceId}`} value={a} checked={action === a} onChange={() => setChoice((c) => ({ ...c, [d.invoiceId]: a }))} />
                  {a === "approve" ? "Approve" : a === "edit" ? "Edit" : "Skip"}
                </label>
              ))}
            </fieldset>
          ) : outcome ? (
            <p className={`mt-3 text-sm font-semibold ${outcome.status === "failed" ? "text-stamp-red" : outcome.status === "skipped" ? "text-ink-soft" : "text-stamp-green"}`}>
              {STATUS_WORDS[outcome.status]}
              {outcome.decision === "edit" ? " (edited)" : ""}
              {outcome.error ? <span className="block text-xs font-normal">{outcome.error}</span> : null}
            </p>
          ) : null}
        </div>
      </li>
    );
  });

  return (
    <div className="space-y-4">
      {drafts.length === 0 ? <p className="text-base text-ink-soft">No invoice is overdue, so there is nothing to chase.</p> : null}
      {waiting ? (
        <form onSubmit={submit} className="space-y-4" aria-label="Invoice reminders">
          <ol className="space-y-3">{rows}</ol>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button type="submit" disabled={busy} className="inline-flex h-11 items-center rounded-pill bg-ink px-6 text-sm font-semibold text-on-night transition-colors duration-[120ms] hover:bg-pp-deep active:bg-night-3 disabled:cursor-not-allowed disabled:opacity-55">
              {busy ? "Sending…" : "Send my choices through PayPal"}
            </button>
            <p className="text-xs text-ink-soft">Nothing is sent until you press this.</p>
          </div>
          {error || localError ? (
            <p role="alert" className="text-sm text-stamp-red">
              {localError ?? error}
            </p>
          ) : null}
        </form>
      ) : (
        <ol className="space-y-3">{rows}</ol>
      )}
      {notDrafted.length > 0 ? (
        <div tabIndex={0} role="region" aria-label="Open invoices that are not overdue yet" className="overflow-x-auto rounded-card border border-line bg-card">
          <table className="w-full text-left text-sm">
            <caption className="px-5 pb-1 pt-4 text-left text-sm font-semibold text-ink">Open invoices that are not overdue yet</caption>
            <thead>
              <tr className="border-b border-line text-ink-soft">
                <th className="py-3 pl-5 pr-3 font-semibold">Invoice</th>
                <th className="py-3 pr-3 font-semibold">Client</th>
                <th className="py-3 pr-3 text-right font-semibold">Amount</th>
                <th className="py-3 pr-3 font-semibold">Due</th>
                <th className="py-3 pr-5 font-semibold">Likely paid</th>
              </tr>
            </thead>
            <tbody>
              {notDrafted.map((o) => (
                <tr key={o.invoiceId} className="border-t border-line first:border-t-0">
                  <td className="py-3 pl-5 pr-3 font-mono">{o.number}</td>
                  <td className="py-3 pr-3 text-ink">{o.payer}</td>
                  <td className="py-3 pr-3 text-right font-semibold tabular-nums">{formatMoney(fromCents(o.amountCents))}</td>
                  <td className="py-3 pr-3 tabular-nums">{o.dueDate}</td>
                  <td className="py-3 pr-5 text-ink-soft">{likely(o)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export default InvoiceTable;
