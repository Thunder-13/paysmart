/**
 * Cash Weather types: run input (validated at start), run state, and the shapes the pure
 * forecast / upstream / budget modules return. Money inside the model is integer cents.
 */
import { z } from "zod";
import { MoneySchema, type Money, type RailInvoice, type RailTransaction } from "@/core/contracts";

export const MAX_PACKAGE_JSON_BYTES = 100 * 1024;

const UsdMoneySchema = MoneySchema.refine((m) => m.currency.toUpperCase() === "USD", {
  message: "Cash Weather works in USD only",
});

function packageJsonProblem(text: string): string | null {
  if (new TextEncoder().encode(text).length > MAX_PACKAGE_JSON_BYTES) return "packageJson is larger than 100 KB";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return "packageJson is not valid JSON";
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "packageJson must be a JSON object";
  return null;
}

export const DEFAULT_PRINCIPAL = { name: "Ana Ruiz Studio", email: "ana@ruiz-studio.example" };
export const DEFAULT_CAP = "150.00";
export const DEFAULT_BUFFER = "2000.00";
export const DEFAULT_SEED = 42;

/** Balance today for the fixture studio. PayPalRail has no balance read, so this is a run input. */
export const DEFAULT_BALANCE = "4500.00";

export const CashWeatherInputSchema = z.object({
  packageJson: z.string().superRefine((text, ctx) => {
    const problem = packageJsonProblem(text);
    if (problem) ctx.addIssue({ code: "custom", message: problem, path: [] });
  }),
  importCounts: z.record(z.string().max(214), z.number().int().min(0).max(1_000_000)).optional(),
  monthlyCap: UsdMoneySchema.default({ currency: "USD", value: DEFAULT_CAP }),
  safetyBuffer: UsdMoneySchema.default({ currency: "USD", value: DEFAULT_BUFFER }),
  currentBalance: UsdMoneySchema.default({ currency: "USD", value: DEFAULT_BALANCE }),
  seed: z.number().int().min(0).max(2 ** 31 - 1).default(DEFAULT_SEED),
  principal: z
    .object({ name: z.string().min(1).max(120), email: z.email().nullable() })
    .default(DEFAULT_PRINCIPAL),
});
export type CashWeatherInput = z.infer<typeof CashWeatherInputSchema>;

/* ------------------------------------------------------------ ingest */

export type DataSource = "rail" | "fixture";

export interface SourceInfo {
  source: DataSource;
  count: number;
  /** Why fixtures were used, or null when the rail data was used. */
  reason: string | null;
}

export interface Notice {
  id: string;
  level: "info" | "warn";
  text: string;
}

export type CwInvoice = RailInvoice & { source: DataSource };
export type CwTransaction = RailTransaction;

/* ---------------------------------------------------------- forecast */

export type Cadence = "weekly" | "biweekly" | "monthly" | "quarterly";

export interface RecurringStream {
  counterparty: string;
  key: string;
  direction: "in" | "out";
  cadence: Cadence;
  intervalDays: number;
  /** Median amount, positive cents. */
  typicalCents: number;
  minCents: number;
  maxCents: number;
  occurrences: number;
  lastDate: string;
  nextDate: string;
  transactionIds: string[];
}

export interface PayerProfile {
  key: string;
  name: string;
  email: string | null;
  paid: number;
  onTime: number;
  /** null when no paid invoice could be matched (unknown history). */
  onTimeRate: number | null;
  /** Days late per matched invoice (negative = early). */
  daysLate: number[];
}

export interface InvoiceOutlook {
  invoiceId: string;
  number: string;
  payer: string;
  amountCents: number;
  dueDate: string;
  daysOverdue: number;
  /** Share of scenarios in which the invoice is paid by day 30. */
  pIn30: number;
  /** Median day (1..90) on which it gets paid, among scenarios that pay within the horizon. */
  medianPayDay: number | null;
  source: DataSource;
}

export type WeatherLabel = "sunny" | "cloudy" | "storm";

export interface WeekWeather {
  week: number;
  startDay: number;
  endDay: number;
  startDate: string;
  endDate: string;
  lowP10Cents: number;
  lowP50Cents: number;
  label: WeatherLabel;
}

export interface ForecastResult {
  asOf: string;
  seed: number;
  scenarios: number;
  horizonDays: number;
  currency: "USD";
  startCents: number;
  bufferCents: number;
  /** Index 0 is today; 1..90 are projected days. */
  p10: number[];
  p50: number[];
  p90: number[];
  streams: RecurringStream[];
  payers: PayerProfile[];
  invoices: InvoiceOutlook[];
  /** Next invoices expected from repeat clients (paid in the model at REPEAT_INVOICE_RATE). */
  projected: { payer: string; issueDate: string; dueDate: string; amountCents: number }[];
  weeks: WeekWeather[];
  excludedCurrencyCount: number;
}

/* --------------------------------------------------------- narrative */

export const NarrativeSchema = z.object({
  forecast: z.string().min(1).max(700),
  risks: z
    .array(z.object({ title: z.string().min(1).max(80), detail: z.string().min(1).max(240), week: z.number().int().min(1).max(13) }))
    .length(3),
});
export type NarrativeBody = z.infer<typeof NarrativeSchema>;
export interface Narrative extends NarrativeBody {
  source: "ai" | "mock" | "fallback";
  reason: string | null;
}

/* ------------------------------------------------------------ nudges */

export type Tone = "friendly" | "firm" | "final";

export const DraftSchema = z.object({
  subject: z.string().min(1).max(120),
  note: z.string().min(1).max(1000),
});
export type DraftBody = z.infer<typeof DraftSchema>;

export interface ReminderDraft extends DraftBody {
  invoiceId: string;
  number: string;
  payer: string;
  amount: Money;
  dueDate: string;
  daysOverdue: number;
  tone: Tone;
  source: DataSource;
  /** True when the template replaced (or stood in for) the model's draft. */
  templated: boolean;
}

export type ReminderStatus = "sent" | "simulated" | "skipped" | "failed";

export interface ReminderOutcome {
  invoiceId: string;
  number: string;
  decision: "approve" | "edit" | "skip";
  status: ReminderStatus;
  subject: string | null;
  error: string | null;
}

/* ---------------------------------------------------------- upstream */

export interface PackageMeta {
  name: string;
  version: string | null;
  maintainers: string[];
  funding: string | null;
  source: "registry" | "fixture" | "unknown";
  offline: boolean;
  error: string | null;
}

export interface PackageRow extends PackageMeta {
  weight: number;
  importCount: number | null;
  mapped: string[];
  route: boolean;
}

export interface ReceiverRow {
  handle: string;
  email: string;
  weightBps: number;
  packages: string[];
}

export interface UpstreamResult {
  packages: PackageRow[];
  receivers: ReceiverRow[];
  rejected: string[];
  skipped: string[];
  explanation: string;
  explanationSource: "ai" | "mock" | "fallback";
  registryMode: "live" | "fixtures";
}

/* ------------------------------------------------------------ budget */

export interface PayoutLine {
  handle: string;
  email: string;
  weightBps: number;
  amount: Money;
  packages: string[];
}

export interface GiveResult {
  day30P10: Money;
  buffer: Money;
  surplus: Money;
  tenPercent: Money;
  cap: Money;
  budget: Money;
  lines: string[];
  payouts: PayoutLine[];
  dropped: string[];
}

/* -------------------------------------------------------------- run */

export type Outcome = "paid" | "blocked" | "declined" | "no_room";

export interface PayoutState {
  verdict: import("@/core/contracts").Verdict | null;
  payoutBatchId: string | null;
  status: string | null;
  items: { senderItemId: string; status: string; transactionId: string | null }[];
}

export interface CashWeatherState extends Record<string, unknown> {
  input: CashWeatherInput;
  asOf: string | null;
  notices: Notice[];
  sources: { transactions: SourceInfo | null; invoices: SourceInfo | null };
  transactions: CwTransaction[];
  invoices: CwInvoice[];
  forecast: ForecastResult | null;
  narrative: Narrative | null;
  upstream: UpstreamResult | null;
  give: GiveResult | null;
  drafts: ReminderDraft[];
  reminders: ReminderOutcome[];
  slipId: string | null;
  payout: PayoutState | null;
  outcome: Outcome | null;
  waitError: string | null;
}
