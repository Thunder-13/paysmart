import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Clause, PayPalRail, RailInvoice } from "@/core/contracts";
import { PayPalError } from "@/core/rail/errors";
import definition, { initialState } from "./index";
import { historyWindows, ingestStep, seedStep } from "./steps/ingest";
import { sentences } from "./narrative";
import { dayOf } from "./dates";
import { AS_OF, ctxFor, fixedRuntime, planned, runSteps, testInput } from "./testkit";

describe("pipeline definition and input", () => {
  it("applies defaults", () => {
    const input = testInput();
    expect(input.monthlyCap).toEqual({ currency: "USD", value: "150.00" });
    expect(input.safetyBuffer).toEqual({ currency: "USD", value: "2000.00" });
    expect(input.seed).toBe(42);
    expect(input.principal.name).toBe("Ana Ruiz Studio");
  });

  it("refuses an unparseable or oversized package.json, naming the field", async () => {
    const { rt } = fixedRuntime();
    await expect(rt.orchestrator.start("cash-weather", { packageJson: "{ not json" })).rejects.toThrow(/packageJson/);
    await expect(rt.orchestrator.start("cash-weather", { packageJson: JSON.stringify({ x: "a".repeat(110 * 1024) }) })).rejects.toThrow(/packageJson/);
    await expect(rt.orchestrator.start("cash-weather", { packageJson: "{}", monthlyCap: { currency: "EUR", value: "5.00" } })).rejects.toThrow(/USD/);
  });

  it("points every next and resumeAt at an existing step", () => {
    const dir = path.join(__dirname, "steps");
    const names = new Set(Object.keys(definition.steps));
    expect(names.has(definition.firstStep)).toBe(true);
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
      const text = readFileSync(path.join(dir, file), "utf8");
      for (const m of text.matchAll(/(?:next|resumeAt): "([a-z_]+)"/g)) expect(names.has(m[1])).toBe(true);
    }
  });
});

describe("seed and ingest", () => {
  it("reads 180 days in six windows of at most 31 days", async () => {
    const windows = historyWindows(AS_OF);
    expect(windows).toHaveLength(6);
    for (const w of windows) expect((Date.parse(w.endDate) - Date.parse(w.startDate)) / 86_400_000).toBeLessThanOrEqual(31);
    expect(dayOf(windows[0].startDate)).toBe(dayOf(AS_OF) - 180);
    expect(dayOf(windows[5].endDate)).toBe(dayOf(AS_OF) - 1);

    const { rt } = fixedRuntime();
    await runSteps(rt, initialState(testInput()), ["seed", "ingest"]);
    const calls = rt.mockRail.calls().filter((c) => c.method === "listTransactions");
    expect(calls).toHaveLength(6);
  });

  it("seeds without duplicates and scopes mock data to the studio", async () => {
    const { rt } = fixedRuntime();
    const once = await runSteps(rt, initialState(testInput()), ["seed", "ingest"]);
    const twice = await runSteps(rt, initialState(testInput()), ["seed", "seed", "ingest"]);
    expect(twice.state.transactions).toEqual(once.state.transactions);
    expect(once.state.transactions.every((t) => t.id.startsWith("cw-fx-"))).toBe(true);
    expect(once.state.invoices).toHaveLength(20);
    expect(once.state.notices.find((n) => n.id === "mock-scope")?.text).toMatch(/left out/);
  });

  it("falls back to sample transactions in sandbox when transaction search is not enabled, keeping real invoices", async () => {
    const { rt } = fixedRuntime({ seedRail: false });
    const real: RailInvoice[] = [
      { id: "INV2-REAL-1", number: "0007", status: "SENT", recipientEmail: "c@example.com", recipientName: "Real Client", amount: { currency: "USD", value: "900.00" }, dueDate: "2026-10-01", issuedAt: "2026-09-01" },
      { id: "INV2-REAL-2", number: "0008", status: "PAID", recipientEmail: "c@example.com", recipientName: "Real Client", amount: { currency: "USD", value: "400.00" }, dueDate: "2026-09-01", issuedAt: "2026-08-01" },
    ];
    const sandbox = {
      ...rt.rail,
      mode: "sandbox",
      listTransactions: async () => {
        throw new PayPalError({ name: "NOT_AUTHORIZED", message: "Authorization failed due to insufficient permissions.", status: 403, debug_id: "d" });
      },
      listInvoices: async () => real,
    } as PayPalRail;
    const state = { ...initialState(testInput()), asOf: AS_OF };
    const ctx = { ...ctxFor(rt, state), rail: sandbox };
    const result = await ingestStep(ctx);
    expect("next" in result && result.next).toBe("forecast");
    const s = { ...state, ...("state" in result ? result.state : {}) };
    expect(s.sources.transactions).toMatchObject({ source: "fixture" });
    expect(s.sources.transactions?.reason).toMatch(/Transaction search/);
    expect(s.sources.invoices).toMatchObject({ source: "rail", count: 2 });
    expect(s.invoices.map((i) => i.id)).toEqual(["INV2-REAL-1", "INV2-REAL-2"]);
    expect(s.notices.some((n) => n.id === "tx-fallback" && n.level === "warn")).toBe(true);
    expect(s.notices.some((n) => n.id === "inv-fallback")).toBe(false);
    // seed is a no-op outside mock mode
    expect("next" in (await seedStep(ctx))).toBe(true);
  });

  it("falls back for invoices too when PayPal has none", async () => {
    const { rt } = fixedRuntime({ seedRail: false });
    const sandbox = { ...rt.rail, mode: "sandbox", listTransactions: async () => [], listInvoices: async () => [] } as PayPalRail;
    const state = { ...initialState(testInput()), asOf: AS_OF };
    const result = await ingestStep({ ...ctxFor(rt, state), rail: sandbox });
    const s = { ...state, ...("state" in result ? result.state : {}) };
    expect(s.sources.transactions?.source).toBe("fixture");
    expect(s.sources.invoices?.source).toBe("fixture");
    expect(s.invoices.every((i) => i.source === "fixture")).toBe(true);
  });
});

describe("forecast, narrate, upstream, budget", () => {
  it("writes a mock narrative of at most three sentences and three risks", async () => {
    const { rt } = fixedRuntime();
    const s = await planned(rt, undefined, false);
    expect(s.narrative?.source).toBe("mock");
    expect(sentences(s.narrative!.forecast).length).toBeLessThanOrEqual(3);
    expect(s.narrative!.risks).toHaveLength(3);
    const lowest = [...s.forecast!.weeks].sort((a, b) => a.lowP10Cents - b.lowP10Cents)[0];
    expect(s.narrative!.risks[0].week).toBe(lowest.week);
    for (const r of s.narrative!.risks) expect(r.week).toBeGreaterThanOrEqual(1);
  });

  it("labels the deterministic narrative when the AI call fails", async () => {
    const { rt } = fixedRuntime();
    vi.spyOn(rt.ai, "json").mockRejectedValue(new Error("model unavailable"));
    const s = await planned(rt, undefined, false);
    expect(s.narrative).toMatchObject({ source: "fallback", reason: "model unavailable" });
    expect(s.narrative!.risks).toHaveLength(3);
  });

  it("computes the budget with the cap binding for the fixture studio", async () => {
    const { rt } = fixedRuntime();
    const s = await planned(rt, undefined, false);
    expect(s.give?.budget).toEqual({ currency: "USD", value: "150.00" });
    expect(s.give?.lines).toHaveLength(6);
    expect(s.upstream?.registryMode).toBe("fixtures");
    expect(s.upstream?.packages.find((p) => p.name === "semver")?.route).toBe(false);
  });
});

describe("draft_slip", () => {
  it("builds the four clauses from the allocation, with no PayPal order", async () => {
    const { rt } = fixedRuntime();
    const s = await planned(rt);
    const slip = rt.store.slips.get(s.slipId!)!;
    expect(slip.pipeline).toBe("cash-weather");
    expect(slip.rail.orderId).toBeNull();
    expect(slip.status).toBe("draft");
    expect(slip.clauses.map((c) => [c.id, c.kind])).toEqual([
      ["c1", "budget_max"],
      ["c2", "split_rule"],
      ["c3", "payee_allowlist"],
      ["c4", "expires_at"],
    ]);
    const split = slip.clauses[1] as Extract<Clause, { kind: "split_rule" }>;
    const allow = slip.clauses[2] as Extract<Clause, { kind: "payee_allowlist" }>;
    const expiry = slip.clauses[3] as Extract<Clause, { kind: "expires_at" }>;
    expect(split.splits.reduce((sum, x) => sum + x.weightBps, 0)).toBe(10000);
    expect(allow.payees).toEqual(s.give!.payouts.map((p) => p.email));
    expect(Date.parse(expiry.at) - rt.now().getTime()).toBe(7 * 86_400_000);
    expect(slip.meta.funding).toBe("paypal_business_balance");
    const types = rt.store.ledger.list(slip.id).map((e) => e.type);
    expect(types).toEqual(["slip.created", "cash-weather.data_source", "cash-weather.forecast", "cash-weather.allocation"]);
  });

  it("writes a two-clause slip and ends without a payout when there is no room", async () => {
    const { rt } = fixedRuntime();
    const s = await planned(rt, testInput({ safetyBuffer: { currency: "USD", value: "20000.00" } }));
    const slip = rt.store.slips.get(s.slipId!)!;
    expect(slip.budget.value).toBe("0.00");
    expect(slip.clauses.map((c) => c.kind)).toEqual(["budget_max", "expires_at"]);
    const { state, result } = await runSteps(rt, { ...s, drafts: [] }, ["confirm_slip"]);
    expect("done" in result).toBe(true);
    expect(state.outcome).toBe("no_room");
    expect(rt.store.slips.get(slip.id)?.status).toBe("released");
    expect(rt.mockRail.calls().some((c) => c.method === "createPayout")).toBe(false);
  });
});
