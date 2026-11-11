/** Pure view helpers for the Dispute Desk page. No server imports: safe in client components. */
import type { Urgency } from "./board";
import { NOTES_MAX, type ActDecision, type Decision, type Outcome } from "./types";

export type Tone = "red" | "amber" | "green" | "muted";

export function durationWords(hours: number): string {
  const h = Math.abs(hours);
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.floor(h / 24)} d`;
}

const STATUS_LABELS: Record<string, string> = {
  WAITING_FOR_SELLER_RESPONSE: "Waiting for your response",
  WAITING_FOR_BUYER_RESPONSE: "Waiting for the buyer",
  UNDER_REVIEW: "Under review",
  OPEN: "Open",
  RESOLVED: "Resolved",
  OTHER: "Other",
};

/** Plain words for a PayPal dispute status; unknown codes read as a sentence ("APPEALABLE" -> "Appealable"). */
export function statusLabel(status: string): string {
  const known = STATUS_LABELS[status];
  if (known) return known;
  const words = status.replace(/_+/g, " ").trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Unknown";
}

/** Urgency chip: always a text label, plus a color. */
export function urgencyChip(urgency: Urgency, hoursLeft: number | null): { text: string; tone: Tone; solid: boolean } {
  switch (urgency) {
    case "overdue":
      return { text: `Overdue ${durationWords(hoursLeft ?? 0)}`, tone: "red", solid: true };
    case "urgent":
      return { text: `Due in ${durationWords(hoursLeft ?? 0)}`, tone: "red", solid: false };
    case "soon":
      return { text: `Due in ${durationWords(hoursLeft ?? 0)}`, tone: "amber", solid: false };
    case "ok":
      return { text: `Due in ${durationWords(hoursLeft ?? 0)}`, tone: "green", solid: false };
    default:
      return { text: "No deadline", tone: "muted", solid: false };
  }
}

export function noteState(notes: string, decision: ActDecision = "contest"): {
  count: number;
  max: number;
  empty: boolean;
  over: boolean;
  canSend: boolean;
  label: string;
} {
  const count = notes.length;
  const empty = notes.trim() === "";
  const over = count > NOTES_MAX;
  const canSend = decision === "hold" ? !over : !empty && !over;
  const label = over ? `${count} / ${NOTES_MAX}: too long by ${count - NOTES_MAX}` : empty ? `0 / ${NOTES_MAX}: write a response first` : `${count} / ${NOTES_MAX}`;
  return { count, max: NOTES_MAX, empty, over, canSend, label };
}

export function chainStamp(chain: { ok: boolean; brokenAtSeq: number | null; eventCount: number } | null): { text: string; tone: Tone } {
  if (!chain) return { text: "No slip linked", tone: "muted" };
  return chain.ok
    ? { text: `Chain verified, ${chain.eventCount} event${chain.eventCount === 1 ? "" : "s"}`, tone: "green" }
    : { text: `Chain broken at #${chain.brokenAtSeq ?? "?"}`, tone: "red" };
}

export function decisionWords(decision: Decision | ActDecision): { word: string; tone: Tone } {
  switch (decision) {
    case "contest":
      return { word: "CONTEST", tone: "green" };
    case "accept":
      return { word: "ACCEPT", tone: "amber" };
    case "hold":
      return { word: "HOLD", tone: "muted" };
    default:
      return { word: "NEED MORE", tone: "muted" };
  }
}

export function outcomeAnnouncement(outcome: Outcome): string {
  const seq = outcome.ledgerSeq !== null ? ` Recorded on the ledger as #${outcome.ledgerSeq}.` : "";
  switch (outcome.kind) {
    case "evidence_sent":
      return `Evidence sent to PayPal. Dispute status ${outcome.paypalStatus ?? "unknown"}.${seq}`;
    case "claim_accepted":
      return `Claim accepted on PayPal. Dispute status ${outcome.paypalStatus ?? "unknown"}.${seq}`;
    case "held":
      return "Held. Nothing was sent to PayPal.";
    default:
      return outcome.message;
  }
}

export const TONE_CLASSES: Record<Tone, { text: string; border: string; wash: string; solid: string }> = {
  red: { text: "text-stamp-red", border: "border-stamp-red", wash: "bg-red-wash", solid: "bg-stamp-red text-paper" },
  amber: { text: "text-stamp-amber", border: "border-stamp-amber", wash: "bg-amber-wash", solid: "bg-stamp-amber text-paper" },
  green: { text: "text-stamp-green", border: "border-stamp-green", wash: "bg-green-wash", solid: "bg-stamp-green text-paper" },
  muted: { text: "text-ink-soft", border: "border-line", wash: "bg-paper-deep", solid: "bg-ink-soft text-paper" },
};
