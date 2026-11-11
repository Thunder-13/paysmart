import { describe, expect, it } from "vitest";
import type { Proposal } from "@/core/contracts";
import { guard } from "@/core/guard";
import { money, toCents, zeroMoney } from "@/core/money";
import { earningsByPublisher } from "./metering";
import {
  buildNetworkSlip,
  buildPayoutProposal,
  buildSettlementProposal,
  itemsTotal,
  largestRemainderBps,
  payoutReceivers,
  settlementItems,
  usageSplits,
} from "./settlement";
import { activeTollSlip, clockedRuntime, railCalls } from "./test-helpers";
import type { Meter } from "./types";

function meter(publisherId: string, value: string, i: number): Meter {
  const names: Record<string, string> = { tidewater: "Tidewater Field Notes", "quarry-street": "Quarry Street Journal", "long-ridge": "Long Ridge Review" };
  const emails: Record<string, string> = { tidewater: "tidewater@example.com", "quarry-street": "quarry@example.com", "long-ridge": "longridge@example.com" };
  return {
    id: `meter_${i}`,
    slipId: "slip_x",
    contentId: `${publisherId}-${i}`,
    title: `Article ${i}`,
    publisherId,
    publisherName: names[publisherId],
    payeeEmail: emails[publisherId],
    amount: money(value),
    proposalId: `prop_${i}`,
    at: `2026-11-10T15:00:0${i}.000Z`,
    settled: false,
    captureId: null,
  };
}

const DEMO_METERS = [meter("tidewater", "0.02", 1), meter("quarry-street", "0.04", 2), meter("long-ridge", "0.05", 3), meter("tidewater", "0.02", 4)];

describe("settlement", () => {
  it("items sum to the meter total and every unitPrice is within the cap", async () => {
    const items = settlementItems(DEMO_METERS);
    expect(itemsTotal(items).value).toBe("0.13");
    for (const i of items) expect(toCents(i.unitPrice)).toBeLessThanOrEqual(5);
    expect(items.map((i) => [i.title, i.quantity])).toEqual([
      ["Long Ridge Review: 1 fetch at $0.05", 1],
      ["Quarry Street Journal: 1 fetch at $0.04", 1],
      ["Tidewater Field Notes: 2 fetches at $0.02", 2],
    ]);

    // A publisher that earned more than the cap still passes the rate card, because items are per unit.
    const { rt } = clockedRuntime();
    const slip = await activeTollSlip(rt, { budget: "1.00", cap: "0.05" });
    const heavy = [1, 2, 3].map((i) => meter("long-ridge", "0.05", i));
    const proposal: Proposal = { ...buildSettlementProposal(slip, heavy), id: "p", createdAt: rt.now().toISOString() };
    expect(proposal.amount.value).toBe("0.15");
    expect(guard(slip, proposal, { spent: zeroMoney(), now: rt.now() }).decision).toBe("within");
  });

  it("publisher split weights sum to 10000 and match usage", () => {
    const earnings = earningsByPublisher(DEMO_METERS);
    expect(earnings.map((e) => [e.publisherId, e.total.value, e.fetches])).toEqual([
      ["long-ridge", "0.05", 1],
      ["quarry-street", "0.04", 1],
      ["tidewater", "0.04", 2],
    ]);
    const splits = usageSplits(earnings);
    expect(Object.fromEntries(splits.map((s) => [s.payee, s.weightBps]))).toEqual({
      "longridge@example.com": 3846,
      "quarry@example.com": 3077,
      "tidewater@example.com": 3077,
    });
    expect(splits.reduce((s, x) => s + x.weightBps, 0)).toBe(10000);

    // Property check: any positive usage vector sums to 10000 and stays within 1 bp of the exact share.
    let seed = 7;
    const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (let n = 0; n < 200; n++) {
      const entries = Array.from({ length: 1 + Math.floor(rand() * 6) }, (_, i) => ({ key: `p${i}`, cents: 1 + Math.floor(rand() * 500) }));
      const total = entries.reduce((s, e) => s + e.cents, 0);
      const out = largestRemainderBps(entries);
      expect(out.reduce((s, x) => s + x.weightBps, 0)).toBe(10000);
      out.forEach((x, i) => expect(Math.abs(x.weightBps - (entries[i].cents * 10000) / total)).toBeLessThan(1));
    }
    expect(() => largestRemainderBps([])).toThrow();

    // Equal remainders: the leftover point goes to the lower publisher id, whatever the emails say.
    const tie = usageSplits([
      { publisherId: "b-pub", name: "B", email: "a@example.com", fetches: 1, total: money("0.01") },
      { publisherId: "a-pub", name: "A", email: "z@example.com", fetches: 1, total: money("0.01") },
      { publisherId: "c-pub", name: "C", email: "m@example.com", fetches: 1, total: money("0.01") },
    ]);
    expect(Object.fromEntries(tie.map((t) => [t.payee, t.weightBps]))).toEqual({ "z@example.com": 3334, "a@example.com": 3333, "m@example.com": 3333 });
  });

  it("network slip carries budget, split, allowlist and expiry", async () => {
    const { rt } = clockedRuntime();
    const toll = await activeTollSlip(rt);
    const ns = buildNetworkSlip({ tollSlip: toll, captureId: "CAP1", earnings: earningsByPublisher(DEMO_METERS), now: rt.now() });
    expect(ns.principal.name).toBe("Toll Road network");
    expect(ns.budget.value).toBe("0.13");
    expect(ns.clauses.map((c) => c.kind)).toEqual(["budget_max", "split_rule", "payee_allowlist", "expires_at"]);
    const allow = ns.clauses.find((c) => c.kind === "payee_allowlist");
    expect(allow && "payees" in allow ? allow.payees.sort() : []).toEqual(["longridge@example.com", "quarry@example.com", "tidewater@example.com"]);
    expect(ns.meta).toMatchObject({ role: "network_payout", tollSlipId: toll.id, captureId: "CAP1" });
  });

  it("payee outside the allowlist gets an outside verdict and no batch", async () => {
    const { rt } = clockedRuntime();
    const toll = await activeTollSlip(rt);
    const earnings = earningsByPublisher(DEMO_METERS);
    const network = rt.core.createSlip(buildNetworkSlip({ tollSlip: toll, captureId: "CAP1", earnings, now: rt.now() }));
    const receivers = payoutReceivers(earnings);
    receivers[0] = { ...receivers[0], receiverEmail: "mallory@example.com" };
    const res = await rt.core.settlePayout(network.id, buildPayoutProposal(network, earnings), receivers);
    expect(res.verdict.decision).toBe("outside");
    expect(res.verdict.violations.some((v) => v.clauseId === "c3")).toBe(true);
    expect(res.payoutBatchId).toBeNull();
    expect(railCalls(rt, "createPayout")).toHaveLength(0);
  });

  it("the honest payout passes the guard", async () => {
    const { rt } = clockedRuntime();
    const toll = await activeTollSlip(rt);
    const earnings = earningsByPublisher(DEMO_METERS);
    const network = rt.core.createSlip(buildNetworkSlip({ tollSlip: toll, captureId: "CAP1", earnings, now: rt.now() }));
    const res = await rt.core.settlePayout(network.id, buildPayoutProposal(network, earnings), payoutReceivers(earnings));
    expect(res.verdict.decision).toBe("within");
    expect(res.payoutBatchId).toBeTruthy();
  });
});
