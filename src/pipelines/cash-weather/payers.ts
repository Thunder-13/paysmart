/**
 * Payer history. PayPal's invoice list carries no paid date, so each PAID invoice is matched to the
 * earliest unmatched incoming payment on or after its issue date with the same amount from the same
 * payer (by email or name). On time = paid no later than 3 days after the due date.
 */
import { toCents } from "@/core/money";
import type { CwInvoice, CwTransaction, PayerProfile } from "./types";
import { counterpartyKey } from "./recurring";
import { dayOf } from "./dates";

export const GRACE_DAYS = 3;
export const DEFAULT_TERMS_DAYS = 30;

export function dueDayOf(invoice: CwInvoice): number {
  return invoice.dueDate ? dayOf(invoice.dueDate) : dayOf(invoice.issuedAt) + DEFAULT_TERMS_DAYS;
}

/** Stable key for a payer: email when present, else the name. */
export function payerKey(invoice: Pick<CwInvoice, "recipientEmail" | "recipientName">): string {
  const email = invoice.recipientEmail?.trim().toLowerCase();
  return email ? email : counterpartyKey(invoice.recipientName ?? "unknown");
}

export function payerMatches(invoice: Pick<CwInvoice, "recipientEmail" | "recipientName">, counterparty: string): boolean {
  const c = counterpartyKey(counterparty);
  if (invoice.recipientEmail && counterpartyKey(invoice.recipientEmail) === c) return true;
  return !!invoice.recipientName && counterpartyKey(invoice.recipientName) === c;
}

export interface PaidMatch {
  invoiceId: string;
  transactionId: string;
  paidDay: number;
  daysLate: number;
}

export function matchPaidInvoices(invoices: CwInvoice[], transactions: CwTransaction[]): PaidMatch[] {
  const used = new Set<string>();
  const incoming = transactions
    .filter((t) => t.amount.currency.toUpperCase() === "USD" && toCents(t.amount) > 0)
    .map((t) => ({ t, day: dayOf(t.date), cents: toCents(t.amount) }))
    .sort((a, b) => a.day - b.day || a.t.id.localeCompare(b.t.id));
  const paid = invoices
    .filter((i) => i.status === "PAID" && i.amount.currency.toUpperCase() === "USD")
    .sort((a, b) => dayOf(a.issuedAt) - dayOf(b.issuedAt) || a.id.localeCompare(b.id));
  const matches: PaidMatch[] = [];
  for (const inv of paid) {
    const issued = dayOf(inv.issuedAt);
    const cents = toCents(inv.amount);
    const hit = incoming.find((x) => !used.has(x.t.id) && x.day >= issued && x.cents === cents && payerMatches(inv, x.t.counterparty));
    if (!hit) continue;
    used.add(hit.t.id);
    matches.push({ invoiceId: inv.id, transactionId: hit.t.id, paidDay: hit.day, daysLate: hit.day - dueDayOf(inv) });
  }
  return matches;
}

export function buildPayerProfiles(invoices: CwInvoice[], matches: PaidMatch[]): PayerProfile[] {
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const profiles = new Map<string, PayerProfile>();
  for (const inv of invoices) {
    const key = payerKey(inv);
    if (!profiles.has(key)) {
      profiles.set(key, {
        key,
        name: inv.recipientName?.trim() || inv.recipientEmail,
        email: inv.recipientEmail || null,
        paid: 0,
        onTime: 0,
        onTimeRate: null,
        daysLate: [],
      });
    }
  }
  for (const m of matches) {
    const inv = byId.get(m.invoiceId);
    if (!inv) continue;
    const p = profiles.get(payerKey(inv));
    if (!p) continue;
    p.paid += 1;
    if (m.daysLate <= GRACE_DAYS) p.onTime += 1;
    p.daysLate.push(m.daysLate);
  }
  for (const p of profiles.values()) p.onTimeRate = p.paid > 0 ? p.onTime / p.paid : null;
  return [...profiles.values()].sort((a, b) => a.key.localeCompare(b.key));
}
