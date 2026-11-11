/**
 * draft_slip: one slip per run, clauses built in code from computed numbers (never by a model),
 * created before the reminder wait so reminders and payouts share one ledger.
 */
import type { Clause, NewSlip, StepContext, StepResult } from "@/core/contracts";
import { formatMoney, toCents } from "@/core/money";
import type { CashWeatherState, GiveResult } from "../types";
import { percent } from "../upstream";

type Ctx = StepContext<CashWeatherState>;
type Res = StepResult<CashWeatherState>;

export const SLIP_DAYS = 7;

export function buildClauses(give: GiveResult, expiresAt: string): Clause[] {
  const end = `${expiresAt.slice(0, 16).replace("T", " ")} UTC`;
  if (toCents(give.budget) === 0 || give.payouts.length === 0) {
    return [
      { id: "c1", kind: "budget_max", label: "Give nothing this month", amount: give.budget },
      { id: "c2", kind: "expires_at", label: `Ends ${end}`, at: expiresAt },
    ];
  }
  const n = give.payouts.length;
  return [
    { id: "c1", kind: "budget_max", label: `Give no more than ${formatMoney(give.budget)} this month`, amount: give.budget },
    {
      id: "c2",
      kind: "split_rule",
      label: `Split by how much my code uses each package: ${give.payouts.map((p) => `${p.handle} ${percent(p.weightBps)}`).join(", ")}`,
      splits: give.payouts.map((p) => ({ payee: p.email, weightBps: p.weightBps })),
    },
    { id: "c3", kind: "payee_allowlist", label: `Pay only these ${n} maintainer${n === 1 ? "" : "s"}`, payees: give.payouts.map((p) => p.email) },
    { id: "c4", kind: "expires_at", label: `Ends ${end}`, at: expiresAt },
  ];
}

export function slipIntent(give: GiveResult): string {
  if (toCents(give.budget) === 0 || give.payouts.length === 0) {
    return "Watch my cash for the next 90 days and send only the invoice reminders I approve. Give nothing to maintainers this month.";
  }
  return `Watch my cash for the next 90 days, send only the invoice reminders I approve, and give up to ${formatMoney(
    give.budget,
  )} this month to the maintainers of the packages my code depends on, split by how much I use them.`;
}

export async function draftSlipStep(ctx: Ctx): Promise<Res> {
  const s = ctx.run.state;
  if (!s.forecast || !s.upstream || !s.give) return { fail: "draft_slip ran before the plan steps" };
  const now = ctx.now();
  const expiresAt = new Date(now.getTime() + SLIP_DAYS * 86_400_000).toISOString();
  const give = s.give;
  const paying = toCents(give.budget) > 0 && give.payouts.length > 0;
  const input: NewSlip = {
    pipeline: "cash-weather",
    principal: s.input.principal,
    intent: slipIntent(give),
    clauses: buildClauses(give, expiresAt),
    budget: give.budget,
    expiresAt,
    meta: {
      summary: paying
        ? `${s.input.principal.name} gives up to ${formatMoney(give.budget)} to ${give.payouts.length} open-source maintainers, paid from the business balance.`
        : `${s.input.principal.name} keeps every dollar this month: the low case leaves no room above the buffer.`,
      funding: "paypal_business_balance",
      allocation: give.payouts,
      forecastSummary: {
        asOf: s.forecast.asOf,
        seed: s.forecast.seed,
        scenarios: s.forecast.scenarios,
        weather: s.forecast.weeks.map((w) => w.label),
      },
      dataSources: s.sources,
      signedInApp: null,
    },
  };
  const slip = ctx.core.createSlip(input);
  const ledger = ctx.store.ledger;
  const tx = s.sources.transactions;
  const inv = s.sources.invoices;
  ledger.append(slip.id, "cash-weather.data_source", "agent", {
    message: `Read ${tx?.count ?? 0} transactions (${tx?.source === "fixture" ? "sample data" : "PayPal"}) and ${inv?.count ?? 0} invoices (${
      inv?.source === "fixture" ? "sample data" : "PayPal"
    })`,
    transactions: tx,
    invoices: inv,
    notices: s.notices,
  });
  const counts = { sunny: 0, cloudy: 0, storm: 0 };
  for (const w of s.forecast.weeks) counts[w.label] += 1;
  ledger.append(slip.id, "cash-weather.forecast", "agent", {
    message: `Forecast: ${counts.sunny} sunny, ${counts.cloudy} cloudy, ${counts.storm} storm weeks; low case on day 30 ${formatMoney(give.day30P10)}`,
    asOf: s.forecast.asOf,
    seed: s.forecast.seed,
    scenarios: s.forecast.scenarios,
    weeks: s.forecast.weeks.map((w) => ({ week: w.week, label: w.label })),
  });
  ledger.append(slip.id, "cash-weather.allocation", "agent", {
    message: paying
      ? `Upstream split: ${give.payouts.map((p) => `${p.handle} ${formatMoney(p.amount)}`).join(", ")}`
      : "No upstream payout this month",
    receivers: give.payouts,
    budget: give.budget,
  });
  return { next: "nudges", slipId: slip.id, state: { slipId: slip.id } };
}
