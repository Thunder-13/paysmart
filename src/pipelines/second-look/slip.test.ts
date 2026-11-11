import { describe, expect, it } from "vitest";
import { fixtureInput } from "./demo-flows";
import { buildPaymentProposal, buildSlip } from "./slip";
import { SecondLookInputSchema } from "./types";

describe("second-look slip", () => {
  it("builds exactly the four clauses", () => {
    const now = new Date("2026-11-09T10:00:00.000Z");
    const input = SecondLookInputSchema.parse(fixtureInput("legit", { sellerEmail: "  Priya.Lens@Example.com " }));
    const slip = buildSlip(input, { now, listingTitle: "Canon lens", analysis: null });
    expect(slip.pipeline).toBe("second-look");
    expect(slip.budget).toEqual({ currency: "USD", value: "120.00" });
    expect(slip.expiresAt).toBe("2026-11-12T10:00:00.000Z");
    expect(slip.clauses.map((c) => [c.id, c.kind])).toEqual([
      ["c1", "payee_allowlist"],
      ["c2", "budget_max"],
      ["c3", "require_evidence"],
      ["c4", "expires_at"],
    ]);
    const [payee, budget, evidence, expiry] = slip.clauses;
    expect(payee.kind === "payee_allowlist" && payee.payees).toEqual(["priya.lens@example.com"]);
    expect(budget.kind === "budget_max" && budget.amount).toEqual({ currency: "USD", value: "120.00" });
    expect(evidence.kind === "require_evidence" && evidence.evidence).toBe("tracking");
    expect(expiry.kind === "expires_at" && expiry.at).toBe("2026-11-12T10:00:00.000Z");
  });

  it("payment proposal names the payee and carries pending tracking", () => {
    const input = SecondLookInputSchema.parse(fixtureInput("legit"));
    const p = buildPaymentProposal(input, { slipId: "slip_1", listingTitle: "Canon lens", payeeEmail: "Other@Example.net" });
    expect(p.kind).toBe("payment");
    expect(p.payee?.email).toBe("other@example.net");
    expect(p.evidence).toEqual([{ kind: "tracking", verdict: "unknown", detail: "Pending until the seller ships.", ref: null }]);
    expect(p.items[0].facts.injectionSuspected).toBe(false);
  });
});
