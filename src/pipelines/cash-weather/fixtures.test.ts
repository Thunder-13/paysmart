import { describe, expect, it } from "vitest";
import { buildStudioFixtures, DEFAULT_PACKAGE_JSON, INJECTION_NOTE, RECEIVERS_FIXTURE, REGISTRY_FIXTURE } from "./fixtures";
import { dayOf } from "./dates";
import { overdueInvoices } from "./nudges";
import { buildPayerProfiles, matchPaidInvoices } from "./payers";
import { parseDependencies } from "./upstream";
import { AS_OF } from "./testkit";

describe("studio fixtures", () => {
  const fx = buildStudioFixtures(AS_OF);

  it("uses unique, stable ids and keeps every date inside the 180 days before the run date", () => {
    const ids = [...fx.transactions.map((t) => t.id), ...fx.invoices.map((i) => i.id)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith("cw-fx-"))).toBe(true);
    const today = dayOf(AS_OF);
    for (const t of fx.transactions) {
      expect(dayOf(t.date)).toBeLessThan(today);
      expect(dayOf(t.date)).toBeGreaterThanOrEqual(today - 180);
    }
    expect(buildStudioFixtures(AS_OF)).toEqual(fx);
    expect(buildStudioFixtures("2026-12-15").transactions.map((t) => t.id)).toEqual(fx.transactions.map((t) => t.id));
  });

  it("has four clients, one foreign-currency payment and the injection note", () => {
    expect(new Set(fx.invoices.map((i) => i.recipientName))).toEqual(new Set(["Northwind Labs", "Kestrel Health", "Brightline Media", "Juniper Co-op"]));
    expect(fx.transactions.filter((t) => t.amount.currency !== "USD")).toHaveLength(1);
    expect(fx.transactions.some((t) => t.note === INJECTION_NOTE)).toBe(true);
  });

  it("leaves three overdue invoices at 6, 20 and 38 days", () => {
    const payers = buildPayerProfiles(fx.invoices, matchPaidInvoices(fx.invoices, fx.transactions));
    expect(overdueInvoices(fx.invoices, payers, AS_OF).map((o) => o.daysOverdue).sort((a, b) => a - b)).toEqual([6, 20, 38]);
  });

  it("maps fixture handles to emails and leaves semver's maintainers without a route", () => {
    for (const email of Object.values(RECEIVERS_FIXTURE)) expect(email).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]+$/);
    const deps = parseDependencies(DEFAULT_PACKAGE_JSON).names;
    for (const name of deps) expect(REGISTRY_FIXTURE[name]).toBeDefined();
    const semver = REGISTRY_FIXTURE.semver as { maintainers: { name: string }[] };
    expect(semver.maintainers.some((m) => m.name in RECEIVERS_FIXTURE)).toBe(false);
  });
});
