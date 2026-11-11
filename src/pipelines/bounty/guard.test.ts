import { describe, expect, it } from "vitest";
import type { EvidenceRef } from "@/core/contracts";
import { money } from "@/core/money";
import { payoutProposal } from "./steps/settle";
import { HOUR, makeKit, railMethods } from "./testkit";

const PASS: EvidenceRef = { kind: "before_after_photos", verdict: "pass", detail: "4 of 4 checks passed", ref: "blob_a,blob_b" };

async function claimedBounty() {
  const kit = makeKit();
  const { bountyId } = await kit.fundedAndClaimed();
  return { kit, bounty: kit.bounty(bountyId) };
}

describe("guard on the payout slip", () => {
  it("payout blocked when evidence missing (guard ask/outside)", async () => {
    const { kit, bounty } = await claimedBounty();
    const res = await kit.rt.core.settlePayout(bounty.payoutSlipId, payoutProposal(bounty, { name: "Dana Ruiz", email: "dana@example.com" }, bounty.reward, null), [
      { receiverEmail: "dana@example.com", amount: bounty.reward, note: "Bounty" },
    ]);
    expect(res.verdict.decision).not.toBe("within");
    expect(["ask", "outside"]).toContain(res.verdict.decision);
    expect([...res.verdict.violations, ...res.verdict.unknowns].map((x) => x.clauseId)).toContain("c2");
    expect(res.payoutBatchId).toBeNull();
    expect(railMethods(kit)).not.toContain("createPayout");
    expect(kit.rt.store.slips.get(bounty.payoutSlipId)!.status).toBe("active");
  });

  it("payout to a different email is outside on payee_allowlist", async () => {
    const { kit, bounty } = await claimedBounty();
    const res = await kit.rt.core.settlePayout(
      bounty.payoutSlipId,
      payoutProposal(bounty, { name: "Mallory", email: "attacker@example.com" }, bounty.reward, PASS),
      [{ receiverEmail: "attacker@example.com", amount: bounty.reward, note: "Bounty" }],
    );
    expect(res.verdict.decision).toBe("outside");
    expect(res.verdict.violations.map((v) => v.clauseId)).toEqual(["c4"]);
    expect(res.payoutBatchId).toBeNull();
  });

  it("payout above the reward is outside on budget_max", async () => {
    const { kit, bounty } = await claimedBounty();
    const res = await kit.rt.core.settlePayout(
      bounty.payoutSlipId,
      payoutProposal(bounty, { name: "Dana Ruiz", email: "dana@example.com" }, money("45.00"), PASS),
      [{ receiverEmail: "dana@example.com", amount: money("45.00"), note: "Bounty" }],
    );
    expect(res.verdict.decision).toBe("outside");
    expect(res.verdict.violations.map((v) => v.clauseId)).toEqual(["c1"]);
  });

  it("payout after the deadline is outside on expires_at", async () => {
    const { kit, bounty } = await claimedBounty();
    kit.clock.advance(49 * HOUR);
    const res = await kit.rt.core.settlePayout(
      bounty.payoutSlipId,
      payoutProposal(bounty, { name: "Dana Ruiz", email: "dana@example.com" }, bounty.reward, PASS),
      [{ receiverEmail: "dana@example.com", amount: bounty.reward, note: "Bounty" }],
    );
    expect(res.verdict.decision).toBe("outside");
    expect(res.verdict.violations.map((v) => v.clauseId)).toEqual(["c3"]);
  });
});
