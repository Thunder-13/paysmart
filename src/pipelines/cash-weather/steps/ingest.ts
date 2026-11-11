/**
 * seed: mock mode only, upserts the fixture studio into the mock rail.
 * ingest: 180 days of transactions in 30-day windows (PayPal transaction search caps a request at
 * 31 days) plus all invoices. Sandbox falls back to fixtures per source, with a visible notice.
 */
import type { RailInvoice, StepContext, StepResult } from "@/core/contracts";
import { asMockRail } from "@/core/rail/mock";
import { isPayPalError } from "@/core/rail/errors";
import type { CashWeatherState, CwInvoice, CwTransaction, Notice, SourceInfo } from "../types";
import { dayOf, isoDate, isoOfDay } from "../dates";
import { buildStudioFixtures, isFixtureId } from "../fixtures";

type Ctx = StepContext<CashWeatherState>;
type Res = StepResult<CashWeatherState>;

export const WINDOW_DAYS = 30;
export const HISTORY_WINDOWS = 6;
export const MIN_SANDBOX_TRANSACTIONS = 20;

export function historyWindows(asOf: string): { startDate: string; endDate: string }[] {
  const first = dayOf(asOf) - WINDOW_DAYS * HISTORY_WINDOWS;
  return Array.from({ length: HISTORY_WINDOWS }, (_, i) => {
    const start = first + i * WINDOW_DAYS;
    return { startDate: `${isoOfDay(start)}T00:00:00.000Z`, endDate: `${isoOfDay(start + WINDOW_DAYS - 1)}T23:59:59.999Z` };
  });
}

function toRailInvoice(inv: CwInvoice): RailInvoice {
  return {
    id: inv.id,
    number: inv.number,
    status: inv.status,
    recipientEmail: inv.recipientEmail,
    recipientName: inv.recipientName,
    amount: inv.amount,
    dueDate: inv.dueDate,
    issuedAt: inv.issuedAt,
  };
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isPermissionError(e: unknown): boolean {
  if (isPayPalError(e)) return e.status === 401 || e.status === 403 || /NOT_AUTHORIZED|PERMISSION_DENIED/.test(e.name);
  return /NOT_AUTHORIZED|PERMISSION_DENIED/.test(errorText(e));
}

export async function seedStep(ctx: Ctx): Promise<Res> {
  const asOf = isoDate(ctx.now());
  const mock = asMockRail(ctx.rail);
  if (mock) {
    const fx = buildStudioFixtures(asOf);
    mock.seedTransactions(fx.transactions);
    mock.seedInvoices(fx.invoices.map(toRailInvoice));
  }
  return { next: "ingest", state: { asOf } };
}

export async function ingestStep(ctx: Ctx): Promise<Res> {
  const asOf = ctx.run.state.asOf ?? isoDate(ctx.now());
  const mockMode = ctx.rail.mode === "mock";
  const notices: Notice[] = [];
  const fx = buildStudioFixtures(asOf);

  // Transactions
  let transactions: CwTransaction[] = [];
  let txSource: SourceInfo;
  try {
    const seen = new Set<string>();
    for (const w of historyWindows(asOf)) {
      for (const t of await ctx.rail.listTransactions(w)) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        transactions.push(t);
      }
    }
    if (mockMode) {
      const other = transactions.filter((t) => !isFixtureId(t.id)).length;
      transactions = transactions.filter((t) => isFixtureId(t.id));
      txSource = { source: "rail", count: transactions.length, reason: null };
      notices.push({
        id: "mock-scope",
        level: "info",
        text: `Mock PayPal: the forecast reads the sample studio's records from the mock account (${transactions.length} transactions).${
          other > 0 ? ` ${other} other demo record${other === 1 ? "" : "s"} on the shared mock account ${other === 1 ? "is" : "are"} left out.` : ""
        }`,
      });
    } else if (transactions.length < MIN_SANDBOX_TRANSACTIONS) {
      const reason = `PayPal returned ${transactions.length} transaction${transactions.length === 1 ? "" : "s"} for the last 180 days, fewer than the ${MIN_SANDBOX_TRANSACTIONS} a forecast needs`;
      transactions = fx.transactions;
      txSource = { source: "fixture", count: transactions.length, reason };
      notices.push({ id: "tx-fallback", level: "warn", text: `${reason}. Showing the sample studio's history instead. New sandbox transactions can take up to 3 hours to appear in transaction search.` });
    } else {
      txSource = { source: "rail", count: transactions.length, reason: null };
    }
  } catch (e) {
    const reason = isPermissionError(e)
      ? "PayPal transaction search is not enabled for this app (turn on Transaction search under the app's Features in the Developer Dashboard)"
      : `PayPal transaction search failed: ${errorText(e).slice(0, 200)}`;
    transactions = fx.transactions;
    txSource = { source: "fixture", count: transactions.length, reason };
    notices.push({ id: "tx-fallback", level: "warn", text: `${reason}. Showing the sample studio's history instead.` });
  }

  // Invoices
  let invoices: CwInvoice[];
  let invSource: SourceInfo;
  try {
    const list = await ctx.rail.listInvoices();
    const fromRail = (mockMode ? list.filter((i) => isFixtureId(i.id)) : list).map((i) => ({ ...i, source: "rail" as const }));
    if (!mockMode && fromRail.length === 0) {
      const reason = "PayPal returned no invoices for this account";
      invoices = fx.invoices;
      invSource = { source: "fixture", count: invoices.length, reason };
      notices.push({ id: "inv-fallback", level: "warn", text: `${reason}. Showing the sample studio's invoices; their reminders are simulated, not sent.` });
    } else {
      invoices = fromRail;
      invSource = { source: "rail", count: invoices.length, reason: null };
    }
  } catch (e) {
    const reason = `PayPal invoice list failed: ${errorText(e).slice(0, 200)}`;
    invoices = fx.invoices;
    invSource = { source: "fixture", count: invoices.length, reason };
    notices.push({ id: "inv-fallback", level: "warn", text: `${reason}. Showing the sample studio's invoices; their reminders are simulated, not sent.` });
  }

  return {
    next: "forecast",
    state: {
      asOf,
      transactions,
      invoices,
      sources: { transactions: txSource, invoices: invSource },
      notices: [...ctx.run.state.notices, ...notices],
    },
  };
}
