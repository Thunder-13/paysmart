/** Display math for a slip: Budget, Held, Spent, Released, Refunded. Safe on server and client. */
import type { EvidenceKind, EvidenceRef, Money, Slip } from "@/core/contracts";
import { fromCents, toCents } from "@/core/money";

export interface SlipFigures {
  budget: Money;
  /** Still on hold at PayPal (authorization minus captures) while the slip is open. */
  held: Money;
  spent: Money;
  /** What went back to the buyer once the slip closed (budget minus spent). */
  released: Money;
  refunded: Money;
}

function m(slip: Slip, key: string): unknown {
  return slip.meta[key];
}

export function slipFigures(slip: Slip): SlipFigures {
  const currency = slip.budget.currency;
  const budget = toCents(slip.budget);
  const spent = toCents(slip.spent);
  const left = Math.max(0, budget - spent);
  const holding =
    !!slip.rail.authorizationId && ["active", "settling"].includes(slip.status) && !m(slip, "finalCaptured") && !m(slip, "voided");
  const closed = ["settled", "released", "refunded"].includes(slip.status);
  let refunded = 0;
  const captures = m(slip, "captures");
  if (captures && typeof captures === "object") {
    for (const c of Object.values(captures as Record<string, { refunded?: Money }>)) {
      if (c?.refunded) refunded += toCents(c.refunded);
    }
  }
  return {
    budget: slip.budget,
    held: fromCents(holding ? left : 0, currency),
    spent: slip.spent,
    released: fromCents(closed ? left : 0, currency),
    refunded: fromCents(refunded, currency),
  };
}

export type EvidenceState = "met" | "pending" | "failed";

/** require_evidence status from slip.meta.evidence: any fail -> failed, else any pass -> met. */
export function evidenceState(slip: Slip, kind: EvidenceKind): EvidenceState {
  const list = Array.isArray(slip.meta.evidence) ? (slip.meta.evidence as EvidenceRef[]) : [];
  const mine = list.filter((e) => e && e.kind === kind);
  if (mine.some((e) => e.verdict === "fail")) return "failed";
  if (mine.some((e) => e.verdict === "pass")) return "met";
  return "pending";
}

export function isSigned(slip: Slip): boolean {
  return !!slip.rail.orderId && !["draft", "awaiting_signature", "rejected"].includes(slip.status);
}

const STATUS_WORDS: Record<Slip["status"], string> = {
  draft: "Draft",
  awaiting_signature: "Waiting for signature",
  active: "Active",
  settling: "Settling",
  settled: "Settled",
  released: "Released",
  refunded: "Refunded",
  disputed: "Disputed",
  expired: "Expired",
  rejected: "Declined",
};

export function statusWords(status: Slip["status"]): string {
  return STATUS_WORDS[status] ?? status;
}

/** "Nov 8, 14:05 UTC". Fixed locale and zone so server and browser render the same text. */
export function shortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })} UTC`;
}
