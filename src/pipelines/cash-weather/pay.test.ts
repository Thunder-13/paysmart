import { describe, expect, it, vi } from "vitest";
import { PayPalError } from "@/core/rail/errors";
import type { GuardVerdictData } from "@/core/events";
import type { CashWeatherState } from "./types";
import { fixedRuntime, planned, runSteps } from "./testkit";

async function atSignature() {
  const { rt, clock } = fixedRuntime();
  const state = await planned(rt);
  const { state: s, result } = await runSteps(rt, state, ["confirm_slip"]);
  expect("wait" in result && result.resumeAt).toBe("pay");
  return { rt, clock, state: s };
}

const payouts = (rt: Awaited<ReturnType<typeof atSignature>>["rt"]) => rt.mockRail.calls().filter((c) => c.method === "createPayout");

describe("guarded patronage payout", () => {
  it("pays every receiver in one PayPal Payouts batch when all are within", async () => {
    const { rt, state } = await atSignature();
    const { state: after, result } = await runSteps(rt, state, ["pay", "payout_status"], { action: "sign" });
    expect("done" in result).toBe(true);
    expect(after.outcome).toBe("paid");
    expect(after.payout?.verdict?.decision).toBe("within");
    expect(after.payout?.status).toBe("SUCCESS");
    expect(after.payout?.items).toHaveLength(state.give!.payouts.length);
    const slip = rt.store.slips.get(state.slipId!)!;
    expect(slip.rail.payoutBatchIds).toEqual([after.payout!.payoutBatchId]);
    expect(slip.spent).toEqual(state.give!.budget);
    expect(slip.status).toBe("settled");
    const [call] = payouts(rt);
    const items = (call.args[0] as { items: { receiverEmail: string; note: string }[] }).items;
    expect(items.map((i) => i.receiverEmail).sort()).toEqual(state.give!.payouts.map((p) => p.email).sort());
    expect(items[0].note).toMatch(/^Thank you for maintaining /);
    expect(rt.store.ledger.list(slip.id).some((e) => e.type === "slip.status" && (e.data as { reason: string }).reason.includes("in_app_confirm"))).toBe(true);
  });

  it("rejects a payee not in the allowlist and pays nobody", async () => {
    const { rt, state } = await atSignature();
    const give = state.give!;
    const tampered: CashWeatherState = {
      ...state,
      give: { ...give, payouts: give.payouts.map((p, i) => (i === 0 ? { ...p, email: "pay-me@attacker.example" } : p)) },
    };
    const { state: after, result } = await runSteps(rt, tampered, ["pay"], { action: "sign" });
    expect("done" in result).toBe(true);
    expect(after.outcome).toBe("blocked");
    const verdict = after.payout!.verdict!;
    expect(verdict.decision).toBe("outside");
    expect(verdict.violations.some((v) => v.clauseId === "c3" && v.message.includes("pay-me@attacker.example"))).toBe(true);
    expect(payouts(rt)).toHaveLength(0);
    const slip = rt.store.slips.get(state.slipId!)!;
    expect(slip.spent.value).toBe("0.00");
    const recorded = rt.store.ledger.list(slip.id).filter((e) => e.type === "guard.verdict");
    expect((recorded.at(-1)!.data as GuardVerdictData).verdict.decision).toBe("outside");
  });

  it("rejects a signature after the slip expires", async () => {
    const { rt, clock, state } = await atSignature();
    clock.now = new Date(clock.now.getTime() + 8 * 86_400_000);
    const { state: after } = await runSteps(rt, state, ["pay"], { action: "sign" });
    expect(after.outcome).toBe("blocked");
    expect(after.payout!.verdict!.violations.map((v) => v.clauseId)).toContain("c4");
    expect(payouts(rt)).toHaveLength(0);
  });

  it("declines without paying", async () => {
    const { rt, state } = await atSignature();
    const { state: after } = await runSteps(rt, state, ["pay"], { approved: false });
    expect(after.outcome).toBe("declined");
    expect(rt.store.slips.get(state.slipId!)?.status).toBe("rejected");
    expect(payouts(rt)).toHaveLength(0);
  });

  it("waits again on a signal it does not understand", async () => {
    const { rt, state } = await atSignature();
    const { result } = await runSteps(rt, state, ["pay"], { action: "pay-everyone" });
    expect("wait" in result && result.resumeAt).toBe("pay");
    expect(payouts(rt)).toHaveLength(0);
  });

  it("fails the run on a PayPal Payouts error and leaves spent at 0.00", async () => {
    const { rt, state } = await atSignature();
    vi.spyOn(rt.rail, "createPayout").mockRejectedValue(
      new PayPalError({ name: "INSUFFICIENT_FUNDS", message: "Sender does not have sufficient funds.", status: 422, debug_id: "d", details: [{ issue: "INSUFFICIENT_FUNDS" }] }),
    );
    const { result } = await runSteps(rt, state, ["pay"], { action: "sign" });
    expect("fail" in result && result.fail).toMatch(/PayPal Payouts failed: PayPal INSUFFICIENT_FUNDS/);
    expect(rt.store.slips.get(state.slipId!)?.spent.value).toBe("0.00");
  });
});
