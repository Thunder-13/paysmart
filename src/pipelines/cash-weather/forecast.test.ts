import { describe, expect, it } from "vitest";
import type { CwInvoice, CwTransaction } from "./types";
import { addDaysIso } from "./dates";
import { buildStudioFixtures } from "./fixtures";
import { forecast, projectRepeatInvoices } from "./forecast";
import { buildPayerProfiles, matchPaidInvoices } from "./payers";
import { detectStreams } from "./recurring";
import { mulberry32 } from "./rng";
import { labelWeek } from "./weather";
import { AS_OF } from "./testkit";
import { dayOf } from "./dates";

function txn(id: string, offset: number, value: string, counterparty: string, currency = "USD"): CwTransaction {
  return { id, date: `${addDaysIso(AS_OF, offset)}T12:00:00.000Z`, amount: { currency, value }, counterparty, note: null };
}

function inv(id: string, payer: string, status: string, issued: number, due: number, value: string): CwInvoice {
  return {
    id,
    number: id,
    status,
    recipientEmail: `${payer.toLowerCase().replace(/\s+/g, "")}@example.com`,
    recipientName: payer,
    amount: { currency: "USD", value },
    dueDate: addDaysIso(AS_OF, due),
    issuedAt: addDaysIso(AS_OF, issued),
    source: "rail",
  };
}

describe("seeded generator", () => {
  it("repeats for the same seed and differs for another", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const seqA = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(seqA);
    expect(Array.from({ length: 5 }, () => c())).not.toEqual(seqA);
  });
});

describe("recurring detection", () => {
  it("detects monthly rent with its typical amount and next date", () => {
    const rows = [-176, -146, -116, -86, -56, -26].map((o, i) => txn(`r${i}`, o, "-1850.00", "Harbor Street Studios"));
    const [s] = detectStreams(rows, AS_OF);
    expect(s).toMatchObject({ direction: "out", cadence: "monthly", typicalCents: 185000, occurrences: 6, nextDate: addDaysIso(AS_OF, 4) });
  });

  it("ignores a one-off payment and irregular gaps", () => {
    expect(detectStreams([txn("a", -40, "-500.00", "Laptop shop")], AS_OF)).toEqual([]);
    const offsets = [-80, -77, -36, -24]; // gaps 3, 41, 12
    expect(detectStreams(offsets.map((o, i) => txn(`g${i}`, o, "-60.00", "Odd vendor")), AS_OF)).toEqual([]);
  });

  it("detects quarterly tax from two payments 91 days apart", () => {
    const [s] = detectStreams([txn("t1", -134, "-3900.00", "Tax"), txn("t2", -43, "-3900.00", "Tax")], AS_OF);
    expect(s).toMatchObject({ cadence: "quarterly", nextDate: addDaysIso(AS_OF, 48) });
  });
});

describe("payer history", () => {
  it("builds a late payer's profile from matched payments", () => {
    const invoices = [0, 1, 2, 3].map((i) => inv(`b${i}`, "Brightline", "PAID", -170 + i * 30, -140 + i * 30, "1000.00"));
    const late = [31, 38, 44, 50];
    const txns = late.map((l, i) => txn(`p${i}`, -140 + i * 30 + l, "1000.00", "Brightline"));
    const [p] = buildPayerProfiles(invoices, matchPaidInvoices(invoices, txns));
    expect(p).toMatchObject({ paid: 4, onTime: 0, onTimeRate: 0 });
    expect(p.daysLate.sort((a, b) => a - b)).toEqual(late);
  });

  it("does not credit an unmatched paid invoice and allows 3 days of grace", () => {
    const invoices = [inv("a", "Juniper", "PAID", -60, -30, "650.00"), inv("b", "Juniper", "PAID", -40, -10, "700.00")];
    const txns = [txn("x", -27, "650.00", "Juniper"), txn("y", -5, "999.00", "Juniper")];
    const [p] = buildPayerProfiles(invoices, matchPaidInvoices(invoices, txns));
    expect(p).toMatchObject({ paid: 1, onTime: 1, onTimeRate: 1, daysLate: [3] });
  });
});

describe("forecast", () => {
  const fx = buildStudioFixtures(AS_OF);
  const input = { asOf: AS_OF, seed: 42, startCents: 450000, bufferCents: 200000, transactions: fx.transactions, invoices: fx.invoices };

  it("is deterministic for a seed and keeps p10 <= p50 <= p90 every day", () => {
    const a = forecast(input);
    expect(forecast(input)).toEqual(a);
    expect(a.p10).toHaveLength(91);
    for (let d = 0; d <= 90; d++) {
      expect(a.p10[d]).toBeLessThanOrEqual(a.p50[d]);
      expect(a.p50[d]).toBeLessThanOrEqual(a.p90[d]);
      expect(Number.isInteger(a.p10[d]) && Number.isInteger(a.p50[d]) && Number.isInteger(a.p90[d])).toBe(true);
    }
    expect(a).toMatchObject({ seed: 42, scenarios: 500, horizonDays: 90, excludedCurrencyCount: 1 });
    expect(forecast({ ...input, seed: 43 }).p10).not.toEqual(a.p10);
  });

  it("gives a late payer a lower chance of paying within 30 days", () => {
    const history = (lateBy: number): { invoices: CwInvoice[]; transactions: CwTransaction[] } => {
      const invoices = [0, 1, 2].map((i) => inv(`h${i}`, "Client", "PAID", -170 + i * 40, -140 + i * 40, "3000.00"));
      const transactions = [0, 1, 2].map((i) => txn(`hp${i}`, -140 + i * 40 + lateBy, "3000.00", "Client"));
      invoices.push(inv("open", "Client", "UNPAID", -40, -10, "3000.00"));
      return { invoices, transactions };
    };
    const onTime = forecast({ ...input, ...history(0) }).invoices.find((i) => i.invoiceId === "open")!;
    const late = forecast({ ...input, ...history(40) }).invoices.find((i) => i.invoiceId === "open")!;
    expect(late.pIn30).toBeLessThan(onTime.pIn30);
    expect(onTime.pIn30).toBeGreaterThan(0.9);
  });

  it("does not count a retainer invoice twice with its income stream", () => {
    const invoices = [0, 1, 2, 3].map((i) => inv(`n${i}`, "Retainer Co", "PAID", -130 + i * 30, -115 + i * 30, "4500.00"));
    const transactions = [0, 1, 2, 3].map((i) => txn(`np${i}`, -118 + i * 30, "4500.00", "Retainer Co"));
    const base = forecast({ ...input, invoices, transactions, startCents: 0 });
    const withOpen = forecast({ ...input, invoices: [...invoices, inv("open", "Retainer Co", "SENT", -10, 5, "4500.00")], transactions, startCents: 0 });
    // The open invoice replaces the next projected retainer payment instead of adding 4,500 on top.
    expect(Math.abs(withOpen.p50[90] - base.p50[90])).toBeLessThan(100000);
    expect(projectRepeatInvoices(invoices, detectStreams(transactions, AS_OF), dayOf(AS_OF), 90)).toEqual([]);
  });

  it("projects the next invoices of a repeat client that is not a stream", () => {
    const projected = projectRepeatInvoices(fx.invoices, detectStreams(fx.transactions, AS_OF), dayOf(AS_OF), 90);
    expect(new Set(projected.map((p) => p.recipientName))).toEqual(new Set(["Kestrel Health", "Brightline Media", "Juniper Co-op"]));
    expect(projected.every((p) => p.status === "PROJECTED" && dayOf(p.issuedAt) > dayOf(AS_OF))).toBe(true);
  });
});

describe("weather", () => {
  it("detects a storm week for the fixture data, and a sunny one", () => {
    const fx = buildStudioFixtures(AS_OF);
    const f = forecast({ asOf: AS_OF, seed: 42, startCents: 450000, bufferCents: 200000, transactions: fx.transactions, invoices: fx.invoices });
    expect(f.weeks).toHaveLength(13);
    expect(f.weeks[12]).toMatchObject({ startDay: 85, endDay: 90 });
    expect(f.weeks.some((w) => w.label === "storm")).toBe(true);
    expect(f.weeks.some((w) => w.label === "sunny")).toBe(true);
    // The quarterly tax lands on day 48, inside week 7.
    expect(f.weeks[6].label).toBe("storm");
  });

  it("labels by the rule", () => {
    expect(labelWeek(-12000, 500000, 200000)).toBe("storm");
    expect(labelWeek(300000, 150000, 200000)).toBe("storm");
    expect(labelWeek(150000, 400000, 200000)).toBe("cloudy");
    expect(labelWeek(250000, 400000, 200000)).toBe("sunny");
  });
});
