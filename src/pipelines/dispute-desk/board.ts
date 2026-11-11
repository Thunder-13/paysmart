/**
 * Deadline board: lanes by PayPal dispute status, urgency from the seller response due date.
 * Pure functions; the server joins disputes with links and case records (see api.ts).
 */
import type { Money, RailDispute } from "@/core/contracts";
import { reasonLabel } from "./reasons";
import type { Decision, DisputeCase, DisputeLink, OutcomeKind } from "./types";

export const LANES = [
  { id: "needs_response", title: "Needs your response", statuses: ["WAITING_FOR_SELLER_RESPONSE"] },
  { id: "open", title: "Open", statuses: ["OPEN"] },
  { id: "waiting_buyer", title: "Waiting on buyer", statuses: ["WAITING_FOR_BUYER_RESPONSE"] },
  { id: "with_paypal", title: "With PayPal", statuses: ["UNDER_REVIEW"] },
  { id: "resolved", title: "Resolved", statuses: ["RESOLVED"] },
  { id: "other", title: "Other", statuses: [] as string[] },
] as const;
export type LaneId = (typeof LANES)[number]["id"];

export type Urgency = "overdue" | "urgent" | "soon" | "ok" | "none";

const HOUR = 3_600_000;
export const URGENT_HOURS = 48;
export const SOON_HOURS = 7 * 24;

export function laneOf(status: string): LaneId {
  const lane = LANES.find((l) => (l.statuses as readonly string[]).includes(status));
  return lane ? lane.id : "other";
}

/** overdue (past), urgent (48 h or less), soon (7 days or less), ok (later), none (no due date). */
export function urgencyOf(dueAt: string | null, now: Date): { urgency: Urgency; hoursLeft: number | null } {
  if (!dueAt) return { urgency: "none", hoursLeft: null };
  const due = Date.parse(dueAt);
  if (Number.isNaN(due)) return { urgency: "none", hoursLeft: null };
  const hoursLeft = (due - now.getTime()) / HOUR;
  if (hoursLeft < 0) return { urgency: "overdue", hoursLeft };
  if (hoursLeft <= URGENT_HOURS) return { urgency: "urgent", hoursLeft };
  if (hoursLeft <= SOON_HOURS) return { urgency: "soon", hoursLeft };
  return { urgency: "ok", hoursLeft };
}

export interface BoardCase {
  runId: string;
  decision: Decision | null;
  confidence: number | null;
  outcome: OutcomeKind | null;
  paypalStatus: string | null;
}

export interface BoardCard {
  disputeId: string;
  reason: string;
  reasonLabel: string;
  status: string;
  amount: Money;
  createdAt: string;
  dueAt: string | null;
  urgency: Urgency;
  hoursLeft: number | null;
  transactionId: string | null;
  buyerEmail: string | null;
  /** Buyer's words, untrusted: display only, escaped by React. */
  messages: string[];
  link: DisputeLink;
  case: BoardCase | null;
}

export interface BoardLane {
  id: LaneId;
  title: string;
  cards: BoardCard[];
}

export interface Board {
  now: string;
  mode: "mock" | "sandbox";
  lanes: BoardLane[];
  total: number;
}

function byDue(a: BoardCard, b: BoardCard): number {
  if (a.dueAt && b.dueAt) return Date.parse(a.dueAt) - Date.parse(b.dueAt) || a.createdAt.localeCompare(b.createdAt);
  if (a.dueAt) return -1;
  if (b.dueAt) return 1;
  return a.createdAt.localeCompare(b.createdAt);
}

export function buildBoard(input: {
  disputes: RailDispute[];
  now: Date;
  mode: "mock" | "sandbox";
  linkOf: (d: RailDispute) => DisputeLink;
  caseOf: (disputeId: string) => DisputeCase | null;
}): Board {
  const lanes: BoardLane[] = LANES.map((l) => ({ id: l.id, title: l.title, cards: [] }));
  for (const d of input.disputes) {
    // A resolved dispute has nothing left to answer, so its old due date carries no urgency.
    const { urgency, hoursLeft } = d.status === "RESOLVED" ? { urgency: "none" as const, hoursLeft: null } : urgencyOf(d.sellerResponseDueAt, input.now);
    const c = input.caseOf(d.id);
    const card: BoardCard = {
      disputeId: d.id,
      reason: d.reason,
      reasonLabel: reasonLabel(d.reason),
      status: d.status,
      amount: d.amount,
      createdAt: d.createdAt,
      dueAt: d.sellerResponseDueAt,
      urgency,
      hoursLeft,
      transactionId: d.transactionId,
      buyerEmail: d.buyerEmail,
      messages: d.messages,
      link: input.linkOf(d),
      case: c ? { runId: c.runId, decision: c.decision, confidence: c.confidence, outcome: c.outcome, paypalStatus: c.paypalStatus } : null,
    };
    lanes.find((l) => l.id === laneOf(d.status))!.cards.push(card);
  }
  for (const lane of lanes) lane.cards.sort(byDue);
  return { now: input.now.toISOString(), mode: input.mode, lanes, total: input.disputes.length };
}

/**
 * The dispute the desk opens on: the most urgent one that needs a response and has a linked slip,
 * then any dispute with a linked slip, then the first card in the most pressing lane.
 * Lanes are already sorted by due date, so the first match in lane order is the most urgent.
 */
export function defaultSelection(board: Board): string | null {
  const cards = board.lanes.flatMap((l) => l.cards);
  const linked = (c: BoardCard) => Boolean(c.link.slipId);
  const needsResponse = board.lanes.find((l) => l.id === "needs_response")?.cards ?? [];
  return (
    needsResponse.find(linked)?.disputeId ??
    cards.find(linked)?.disputeId ??
    board.lanes[0]?.cards[0]?.disputeId ??
    cards[0]?.disputeId ??
    null
  );
}

/** An empty board (used when the rail can't list disputes). */
export function emptyBoard(now: Date, mode: "mock" | "sandbox"): Board {
  return buildBoard({ disputes: [], now, mode, linkOf: () => ({ method: "none", slipId: null }), caseOf: () => null });
}
