/**
 * Reminder tone, decided by rule before any model call. The model writes words in this tone and
 * cannot change it, and nothing a payer writes can talk it up or down.
 *   final     45+ days overdue, or a payer with 2+ paid invoices, under 50% on time, and 30+ days overdue
 *   firm      otherwise 15+ days overdue, or a payer under 80% on time
 *   friendly  otherwise (unknown history counts as neither good nor bad)
 */
import type { PayerProfile, Tone } from "./types";

export function chooseTone(daysOverdue: number, profile: Pick<PayerProfile, "paid" | "onTimeRate"> | null | undefined): Tone {
  const rate = profile?.onTimeRate ?? null;
  const paid = profile?.paid ?? 0;
  if (daysOverdue >= 45) return "final";
  if (rate !== null && paid >= 2 && rate < 0.5 && daysOverdue >= 30) return "final";
  if (daysOverdue >= 15) return "firm";
  if (rate !== null && rate < 0.8) return "firm";
  return "friendly";
}

export const TONE_WORDS: Record<Tone, string> = {
  friendly: "Friendly",
  firm: "Firm",
  final: "Final",
};
