import { describe, expect, it } from "vitest";
import type { Verdict } from "@/core/contracts";
import { sumMoney } from "@/core/money";
import { refusalReason, tollBooth } from "./gateway";
import { metersForSlip } from "./metering";
import { activeTollSlip, clockedRuntime, draftTollSlip, gatewayDeps, railCalls } from "./test-helpers";
import { WWW_AUTHENTICATE, type QuoteBody } from "./types";

describe("toll booth gateway", () => {
  it("402 without header", () => {
    const { rt } = clockedRuntime();
    const res = tollBooth(gatewayDeps(rt), "tw-1", null);
    expect(res.status).toBe(402);
    expect(res.headers["WWW-Authenticate"]).toBe(WWW_AUTHENTICATE);
    expect(res.headers["WWW-Authenticate"]).toBe('PermissionSlip realm="toll-road"');
    const body = res.body as QuoteBody;
    expect(body).toMatchObject({
      error: "payment_required",
      reason: "no_slip",
      price: "0.02",
      currency: "USD",
      publisher: "Tidewater Field Notes",
      content: { id: "tw-1" },
    });
    expect(body.howToPay.length).toBeGreaterThan(10);
    expect(JSON.stringify(body)).not.toContain("rolling boil");
  });

  it("404 unknown content", () => {
    const { rt } = clockedRuntime();
    const res = tollBooth(gatewayDeps(rt), "nope", "anything");
    expect(res.status).toBe(404);
  });

  it("unknown slip id", async () => {
    const { rt } = clockedRuntime();
    const missing = tollBooth(gatewayDeps(rt), "tw-1", "slip_doesnotexist");
    expect(missing.status).toBe(402);
    expect((missing.body as QuoteBody).reason).toBe("slip_unknown");

    const other = rt.core.createSlip({
      pipeline: "shop",
      principal: { name: "x", email: null },
      intent: "shop",
      clauses: [{ id: "c1", kind: "budget_max", label: "b", amount: { currency: "USD", value: "5.00" } }],
      budget: { currency: "USD", value: "5.00" },
      expiresAt: new Date(rt.now().getTime() + 3_600_000).toISOString(),
    });
    const foreign = tollBooth(gatewayDeps(rt), "tw-1", other.id);
    expect((foreign.body as QuoteBody).reason).toBe("slip_unknown");
    expect(metersForSlip(rt.store, other.id)).toHaveLength(0);
  });

  it("slip not yet signed", () => {
    const { rt } = clockedRuntime();
    const slip = draftTollSlip(rt);
    const res = tollBooth(gatewayDeps(rt), "tw-1", slip.id);
    expect(res.status).toBe(402);
    expect((res.body as QuoteBody).reason).toBe("slip_not_active");
    expect(metersForSlip(rt.store, slip.id)).toHaveLength(0);
  });

  it("paid fetch", async () => {
    const { rt } = clockedRuntime();
    const slip = await activeTollSlip(rt);
    const callsBefore = railCalls(rt).length;
    const res = tollBooth(gatewayDeps(rt), "tw-1", slip.id);
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.charged.value).toBe("0.02");
    expect(res.body.remaining.value).toBe("0.13");
    expect(res.body.body).toContain("rolling boil");
    expect(res.headers["x-toll-charged"]).toBe("0.02");

    const meters = metersForSlip(rt.store, slip.id);
    expect(meters).toHaveLength(1);
    expect(meters[0]).toMatchObject({ contentId: "tw-1", payeeEmail: "tidewater@example.com", amount: { value: "0.02" }, settled: false });

    const events = rt.store.ledger.list(slip.id);
    const [verdict, metered] = events.slice(-2);
    expect(verdict.type).toBe("guard.verdict");
    expect((verdict.data as { verdict: Verdict }).verdict.decision).toBe("within");
    expect(metered.type).toBe("toll-road.metered");
    expect(railCalls(rt).length).toBe(callsBefore);
  });

  it("metering sums", async () => {
    const { rt } = clockedRuntime();
    const slip = await activeTollSlip(rt);
    for (const id of ["tw-1", "qs-1", "lr-1", "tw-2"]) {
      expect(tollBooth(gatewayDeps(rt), id, slip.id).status).toBe(200);
    }
    const meters = metersForSlip(rt.store, slip.id);
    expect(meters).toHaveLength(4);
    expect(sumMoney(meters.map((m) => m.amount)).value).toBe("0.13");
    const last = rt.store.ledger
      .list(slip.id)
      .filter((e) => e.type === "toll-road.metered")
      .at(-1);
    expect(last?.data).toMatchObject({ fetches: 4, spent: { value: "0.13" }, remaining: { value: "0.02" } });
  });

  it("402 when budget exhausted", async () => {
    const { rt } = clockedRuntime();
    const slip = await activeTollSlip(rt);
    for (const id of ["tw-1", "qs-1", "lr-1", "tw-2"]) tollBooth(gatewayDeps(rt), id, slip.id);
    const res = tollBooth(gatewayDeps(rt), "qs-2", slip.id);
    expect(res.status).toBe(402);
    expect(res.headers["WWW-Authenticate"]).toBe(WWW_AUTHENTICATE);
    expect(res.body).toMatchObject({ reason: "budget_exhausted", spent: "0.13", remaining: "0.02" });
    expect(metersForSlip(rt.store, slip.id)).toHaveLength(4);
    const [verdict, refused] = rt.store.ledger.list(slip.id).slice(-2);
    expect(verdict.type).toBe("guard.verdict");
    expect((verdict.data as { verdict: Verdict }).verdict.decision).toBe("outside");
    expect(refused.type).toBe("toll-road.refused");
    expect(refused.data).toMatchObject({ reason: "budget_exhausted", contentId: "qs-2" });
  });

  it("price above cap rejected", async () => {
    const { rt } = clockedRuntime();
    const slip = await activeTollSlip(rt);
    const res = tollBooth(gatewayDeps(rt), "lr-2", slip.id);
    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({ reason: "price_above_cap", price: "0.09" });
    expect(metersForSlip(rt.store, slip.id)).toHaveLength(0);
  });

  it("slip expired", async () => {
    const { rt, clock } = clockedRuntime();
    const slip = await activeTollSlip(rt, { minutes: 60 });
    clock.advance(61 * 60_000);
    const res = tollBooth(gatewayDeps(rt), "tw-1", slip.id);
    expect(res.status).toBe(402);
    expect((res.body as QuoteBody).reason).toBe("slip_expired");
    expect(metersForSlip(rt.store, slip.id)).toHaveLength(0);
  });

  it("second fetch of the same article is not charged", async () => {
    const { rt } = clockedRuntime();
    const slip = await activeTollSlip(rt);
    tollBooth(gatewayDeps(rt), "tw-1", slip.id);
    const again = tollBooth(gatewayDeps(rt), "tw-1", slip.id);
    expect(again.status).toBe(200);
    if (again.status !== 200) return;
    expect(again.body.charged.value).toBe("0.00");
    expect(again.body.alreadyPaid).toBe(true);
    expect(metersForSlip(rt.store, slip.id)).toHaveLength(1);
  });

  it("concurrent fetches with room for one", async () => {
    const { rt } = clockedRuntime();
    const slip = await activeTollSlip(rt, { budget: "0.05", cap: "0.05" });
    const results = await Promise.all(
      ["qs-1", "qs-2"].map((id) => Promise.resolve().then(() => tollBooth(gatewayDeps(rt), id, slip.id))),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 402]);
    const refused = results.find((r) => r.status === 402);
    expect((refused?.body as QuoteBody).reason).toBe("budget_exhausted");
    expect(metersForSlip(rt.store, slip.id)).toHaveLength(1);
  });

  it("maps violations to reasons with expiry first, then cap, then budget", async () => {
    const { rt } = clockedRuntime();
    const slip = await activeTollSlip(rt);
    const v = (ids: string[]): Verdict => ({
      decision: "outside",
      violations: ids.map((clauseId) => ({ clauseId, message: clauseId })),
      unknowns: [],
      checkedAt: rt.now().toISOString(),
    });
    expect(refusalReason(slip, v(["c1", "c2", "c3"]))).toBe("slip_expired");
    expect(refusalReason(slip, v(["c1", "c2"]))).toBe("price_above_cap");
    expect(refusalReason(slip, v(["c1"]))).toBe("budget_exhausted");
    expect(refusalReason(slip, v(["integrity"]))).toBe("needs_review");
  });
});
