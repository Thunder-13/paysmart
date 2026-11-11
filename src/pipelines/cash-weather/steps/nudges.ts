/**
 * nudges: tone by rule, words by the fast tier, then wait for Ana (approve, edit or skip each).
 * send_nudges: send what she approved through PayPal Invoicing and record every decision.
 */
import type { RunWait, StepContext, StepResult } from "@/core/contracts";
import type { CashWeatherState, ReminderDraft, ReminderOutcome } from "../types";
import { draftReminder, overdueInvoices, parseReminderSignal } from "../nudges";

type Ctx = StepContext<CashWeatherState>;
type Res = StepResult<CashWeatherState>;

export function nudgeWait(drafts: ReminderDraft[], problem: string | null): RunWait {
  const n = drafts.length;
  const base = `Review ${n} invoice reminder${n === 1 ? "" : "s"}. Nothing is sent until you approve.`;
  return {
    kind: "user_confirm",
    message: problem ? `${problem}. Nothing was sent. ${base}` : base,
    data: { confirmLabel: n === 1 ? "Send the reminder" : "Send all reminders", declineLabel: "Skip all", invoiceIds: drafts.map((d) => d.invoiceId) },
  };
}

export async function nudgesStep(ctx: Ctx): Promise<Res> {
  const s = ctx.run.state;
  if (!s.forecast || !s.asOf || !s.slipId) return { fail: "nudges ran before the slip existed" };
  const overdue = overdueInvoices(s.invoices, s.forecast.payers, s.asOf);
  if (overdue.length === 0) return { next: "confirm_slip", state: { drafts: [] } };
  const drafts: ReminderDraft[] = [];
  for (const o of overdue) {
    const d = await draftReminder(ctx.ai, o, s.input.principal.name);
    drafts.push(d);
    ctx.store.ledger.append(s.slipId, "cash-weather.nudge_drafted", "agent", {
      message: `Drafted a ${d.tone} reminder for invoice ${d.number} (${d.payer}, ${d.daysOverdue} days overdue)`,
      invoiceId: d.invoiceId,
      tone: d.tone,
      templated: d.templated,
    });
  }
  return { wait: nudgeWait(drafts, null), resumeAt: "send_nudges", state: { drafts, waitError: null } };
}

export async function sendNudgesStep(ctx: Ctx): Promise<Res> {
  const s = ctx.run.state;
  if (!s.slipId) return { fail: "send_nudges ran before the slip existed" };
  const slipId = s.slipId;
  const parsed = parseReminderSignal(ctx.signal, s.drafts);
  if (!parsed.ok) {
    return { wait: nudgeWait(s.drafts, parsed.error), resumeAt: "send_nudges", state: { waitError: parsed.error } };
  }
  const ledger = ctx.store.ledger;
  for (const id of parsed.rejected) {
    ledger.append(slipId, "cash-weather.signal_rejected", "system", {
      message: `Ignored a decision for invoice ${id.slice(0, 64)}: no reminder was drafted for it`,
      invoiceId: id.slice(0, 64),
    });
  }
  const byId = new Map(s.drafts.map((d) => [d.invoiceId, d]));
  const outcomes: ReminderOutcome[] = [];
  for (const decision of parsed.decisions) {
    const draft = byId.get(decision.invoiceId)!;
    if (decision.action === "skip") {
      outcomes.push({ invoiceId: draft.invoiceId, number: draft.number, decision: "skip", status: "skipped", subject: null, error: null });
      ledger.append(slipId, "cash-weather.nudge_skipped", "user", { message: `Skipped the reminder for invoice ${draft.number}`, invoiceId: draft.invoiceId });
      continue;
    }
    if (draft.source === "fixture") {
      outcomes.push({ invoiceId: draft.invoiceId, number: draft.number, decision: decision.action, status: "simulated", subject: decision.subject, error: null });
      ledger.append(slipId, "cash-weather.reminder_simulated", "agent", {
        message: `Sample invoice ${draft.number}: reminder recorded, not sent to PayPal`,
        invoiceId: draft.invoiceId,
        subject: decision.subject,
        tone: draft.tone,
        decision: decision.action,
      });
      continue;
    }
    try {
      const res = await ctx.rail.sendInvoiceReminder(draft.invoiceId, { subject: decision.subject, note: decision.note });
      outcomes.push({ invoiceId: draft.invoiceId, number: draft.number, decision: decision.action, status: "sent", subject: decision.subject, error: null });
      ledger.append(slipId, "rail.invoice_reminder", "rail", {
        invoiceId: draft.invoiceId,
        subject: decision.subject,
        number: draft.number,
        tone: draft.tone,
        decision: decision.action,
        status: res.status,
      });
    } catch (e) {
      const error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      outcomes.push({ invoiceId: draft.invoiceId, number: draft.number, decision: decision.action, status: "failed", subject: decision.subject, error });
      ledger.append(slipId, "cash-weather.nudge_failed", "rail", { message: `PayPal refused the reminder for invoice ${draft.number}: ${error}`, invoiceId: draft.invoiceId, error });
    }
  }
  return { next: "confirm_slip", state: { reminders: outcomes, waitError: null } };
}
