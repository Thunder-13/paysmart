import { describe, expect, it } from "vitest";
import { money } from "@/core/money";
import { coreRuntime, item, newProposal, newSlipInput } from "@/core/test-helpers";
import { tamperEvent } from "@/core/testing";
import { chainFigures, consoleFigures, moneyFigures } from "./ledger-figures";

async function signed(rt: ReturnType<typeof coreRuntime>) {
  const slip = rt.core.createSlip(newSlipInput());
  const { orderId } = await rt.core.beginSigning(slip.id, { intent: "AUTHORIZE", returnPath: "/p/shop" });
  rt.mockRail.approveOrder(orderId, "ada@example.com");
  await rt.core.completeSigning(slip.id);
  return slip.id;
}

describe("ledger figures", () => {
  it("reads held, captured, released and refunded from the ledger", async () => {
    const rt = coreRuntime();
    const id = await signed(rt);
    const res = await rt.core.settlePurchase(id, newProposal({ slipId: id, amount: money("30.00"), items: [item({ unitPrice: money("30.00") })] }), { finalCapture: true });
    await rt.core.releaseRemainder(id);
    await rt.core.refund(id, { captureId: res.captureId!, amount: money("10.00"), reason: "test" });
    expect(moneyFigures(rt.store, [id])).toEqual({
      held: money("50.00"),
      captured: money("30.00"),
      released: money("20.00"),
      paidOut: money("0.00"),
      refunded: money("10.00"),
    });
  });

  it("counts nothing as released while the hold is still open", async () => {
    const rt = coreRuntime();
    const id = await signed(rt);
    expect(moneyFigures(rt.store, [id]).released).toEqual(money("0.00"));
    expect(moneyFigures(rt.store, [id]).held).toEqual(money("50.00"));
  });

  it("reports a tampered chain per slip and ledger-wide", async () => {
    const rt = coreRuntime();
    const a = await signed(rt);
    const b = await signed(rt);
    expect(chainFigures(rt.store, [a, b])).toMatchObject({ ok: true, slips: 2, broken: [] });
    tamperEvent(rt.store, b, 2);
    const chain = chainFigures(rt.store, [a, b]);
    expect(chain.ok).toBe(false);
    expect(chain.broken).toEqual([{ slipId: b, brokenAtSeq: 2 }]);
    const figures = consoleFigures(rt);
    expect(figures.ledger.ok).toBe(false);
    expect(figures.pipelines.shop.slips).toBe(2);
    expect(figures.pipelines.bounty).toMatchObject({ slips: 0, moved: money("0.00"), chain: { ok: true, slips: 0 } });
  });
});
