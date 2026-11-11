/** Shared shapes for the Toll Road pipeline. Plain data only, safe to import from client code. */
import type { Money } from "@/core/contracts";

export const TOLL_ROAD = "toll-road" as const;

/** Header that carries the toll slip id on a gateway request. */
export const SLIP_HEADER = "x-permission-slip";
/** Sent on every 402 so clients know which scheme the booth speaks. */
export const WWW_AUTHENTICATE = 'PermissionSlip realm="toll-road"';

export interface Publisher {
  id: string;
  name: string;
  /** PayPal payout email. */
  email: string;
  blurb: string;
}

/** Notes the quarantined reader hands to the research agent instead of raw article text. */
export interface ReaderNotes {
  keyPoints: string[];
  injectionSuspected: boolean;
}

export interface Content {
  id: string;
  publisherId: string;
  title: string;
  summary: string;
  body: string;
  /** Price per fetch. */
  price: Money;
  /** Hand-written notes used by the reader's mock (seed articles only). */
  mockNotes?: ReaderNotes;
  createdAt: string;
}

export interface Meter {
  id: string;
  slipId: string;
  contentId: string;
  title: string;
  publisherId: string;
  publisherName: string;
  payeeEmail: string;
  amount: Money;
  proposalId: string;
  at: string;
  settled: boolean;
  captureId: string | null;
}

export type RefusalReason =
  | "no_slip"
  | "slip_unknown"
  | "slip_not_active"
  | "slip_expired"
  | "price_above_cap"
  | "budget_exhausted"
  | "needs_review";

export interface PublisherEarning {
  publisherId: string;
  name: string;
  email: string;
  fetches: number;
  total: Money;
}

/** Running totals carried on every toll-road.metered / toll-road.refused event. */
export interface RunningTotals {
  /** Paid fetches (meters) under the slip so far. */
  fetches: number;
  spent: Money;
  remaining: Money;
  byPublisher: PublisherEarning[];
}

export interface QuoteBody {
  error: "payment_required";
  reason: RefusalReason;
  message: string;
  price: string;
  currency: string;
  publisher: string;
  content: { id: string; title: string };
  howToPay: string;
  spent?: string;
  remaining?: string;
}

export interface ContentBody {
  id: string;
  title: string;
  publisher: string;
  body: string;
  charged: Money;
  alreadyPaid: boolean;
  meterId: string;
  spent: Money;
  remaining: Money;
}

export type GatewayResult =
  | { status: 200; headers: Record<string, string>; body: ContentBody }
  | { status: 402; headers: Record<string, string>; body: QuoteBody }
  | { status: 404; headers: Record<string, string>; body: { error: "not_found"; message: string } };

export type FetchOutcome = "paid" | "already_paid" | "refused" | "stopped" | "not_found";

export interface FetchAttempt {
  contentId: string;
  title: string | null;
  publisher: string | null;
  price: string | null;
  outcome: FetchOutcome;
  reason: RefusalReason | null;
  charged: string | null;
  injectionSuspected: boolean;
}

export type StopReason = "finished" | "budget_exhausted" | "slip_expired" | "slip_not_active" | "slip_unknown" | "max_steps";
export type TollOutcome = "declined" | "not_signed" | "nothing_to_settle" | "paid";

export type TollState = {
  question: string;
  intent: string;
  operator: string;
  tollSlipId: string | null;
  summary: string | null;
  orderId: string | null;
  approveUrl: string | null;
  attempts: FetchAttempt[];
  answer: string | null;
  citations: string[];
  droppedCitations: string[];
  stopReason: StopReason | null;
  needsNewSlip: boolean;
  meterTotal: Money | null;
  captureId: string | null;
  earnings: PublisherEarning[];
  networkSlipId: string | null;
  payoutBatchId: string | null;
  splits: { payee: string; weightBps: number }[];
  outcome: TollOutcome | null;
};

export const DEFAULT_QUESTION = "How do small coastal towns keep drinking water safe after a big storm?";
export const DEFAULT_INTENT =
  "Let my research agent spend up to $0.15 reading articles, no more than 5 cents per article, for the next hour.";
export const DEFAULT_OPERATOR = "Research desk";

export function gatewayPath(contentId: string): string {
  return `/api/p/toll-road/content/${encodeURIComponent(contentId)}`;
}
