import { describe, expect, it } from "vitest";
import { INTEGRITY_CLAUSE_ID, type Clause, type Proposal, type Slip } from "./contracts";
import { guard, INTEGRITY_MESSAGE } from "./guard";
import { money } from "./money";
import { BUDGET_50, facts, item, proposalFixture, slipFixture } from "./test-helpers";

const now = new Date("2026-11-08T12:00:00.000Z");
const ctx = { spent: money("0.00"), now };

function check(clauses: Clause[], p: Partial<Proposal> = {}, c = ctx, slip: Partial<Slip> = {}) {
  return guard(slipFixture(clauses, slip), proposalFixture(p), c);
}

describe("guard: budget_max", () => {
  it("passes when amount + spent fits", () => {
    expect(check([BUDGET_50], { amount: money("30.00") }, { spent: money("20.00"), now }).decision).toBe("within");
  });
  it("violates when amount + spent exceeds, citing the label", () => {
    const v = check([BUDGET_50], { amount: money("30.01") }, { spent: money("20.00"), now });
    expect(v.decision).toBe("outside");
    expect(v.violations[0].clauseId).toBe("c1");
    expect(v.violations[0].message).toContain("Spend at most $50");
    expect(v.violations[0].message).toContain("$30.00");
  });
  it("violates on a currency mismatch instead of throwing", () => {
    expect(check([BUDGET_50], { amount: money("1", "EUR") }).decision).toBe("outside");
  });
  it("does not apply to refunds", () => {
    expect(check([BUDGET_50], { kind: "refund", amount: money("500"), items: [] }).decision).toBe("within");
  });
});

describe("guard: quantity_max", () => {
  const q2: Clause = { id: "c2", kind: "quantity_max", label: "Two at most", count: 2 };
  it("counts quantity times units per listing", () => {
    expect(check([q2], { items: [item({ quantity: 2 })] }).decision).toBe("within");
    const v = check([q2], { items: [item({ quantity: 1, facts: facts({ itemCount: 4 }) })] });
    expect(v.decision).toBe("outside");
    expect(v.violations[0].message).toContain("4 units");
  });
  it("unknown count is 1, and only asks when the title looks like a multi-pack", () => {
    expect(check([q2], { items: [item({ facts: facts({ itemCount: null }) })] }).decision).toBe("within");
    const v = check([q2], { items: [item({ title: "Bath toys 6-pack", facts: facts({ itemCount: null }) })] });
    expect(v.decision).toBe("ask");
    expect(v.unknowns[0]).toMatchObject({ clauseId: "c2", field: "itemCount" });
  });
});

describe("guard: category_in", () => {
  const cat: Clause = { id: "c2", kind: "category_in", label: "Toys or books", categories: ["Toys", "books"] };
  it("matches case-insensitively", () => {
    expect(check([cat], { items: [item({ facts: facts({ category: "TOYS" }) })] }).decision).toBe("within");
  });
  it("violates outside the list", () => {
    expect(check([cat], { items: [item({ facts: facts({ category: "electronics" }) })] }).decision).toBe("outside");
  });
  it("asks when the category is unknown", () => {
    const v = check([cat], { items: [item({ facts: facts({ category: null }) })] });
    expect(v.decision).toBe("ask");
    expect(v.unknowns[0].field).toBe("category");
  });
});

describe("guard: deliver_by", () => {
  const by: Clause = { id: "c3", kind: "deliver_by", label: "Arrives by Nov 21", date: "2026-11-21" };
  it("passes on or before the date (datetime estimates compare by day)", () => {
    expect(check([by], { items: [item({ facts: facts({ deliveryEstimate: "2026-11-21T23:00:00Z" }) })] }).decision).toBe("within");
  });
  it("violates after the date", () => {
    expect(check([by], { items: [item({ facts: facts({ deliveryEstimate: "2026-11-22" }) })] }).decision).toBe("outside");
  });
  it("asks when the estimate is missing", () => {
    expect(check([by], { items: [item({ facts: facts({ deliveryEstimate: null }) })] }).decision).toBe("ask");
  });
  it("is skipped for a payout with no items", () => {
    expect(check([by], { kind: "payout", items: [], payee: { email: "a@x.com", merchantId: null, name: null } }).decision).toBe("within");
  });
});

describe("guard: exclude_attribute", () => {
  const noBatt: Clause = { id: "c4", kind: "exclude_attribute", label: "Nothing that needs batteries", attribute: "power_source", values: ["battery"] };
  it("passes when the attribute has another value", () => {
    expect(check([noBatt]).decision).toBe("within");
  });
  it("violates when the attribute is excluded (case-insensitive)", () => {
    const v = check([noBatt], { items: [item({ facts: facts({ attributes: { power_source: "Battery" } }) })] });
    expect(v.decision).toBe("outside");
    expect(v.violations[0].message).toContain("Nothing that needs batteries");
  });
  it("asks when the attribute is missing or null", () => {
    expect(check([noBatt], { items: [item({ facts: facts({ attributes: {} }) })] }).decision).toBe("ask");
    expect(check([noBatt], { items: [item({ facts: facts({ attributes: { power_source: null } }) })] }).decision).toBe("ask");
  });
});

describe("guard: payee_allowlist", () => {
  const allow: Clause = { id: "c5", kind: "payee_allowlist", label: "Only Sam", payees: ["Sam@Example.com", "MERCH123"] };
  it("matches email or merchant id case-insensitively", () => {
    expect(check([allow], { kind: "payment", payee: { email: "sam@example.com", merchantId: null, name: null } }).decision).toBe("within");
    expect(check([allow], { kind: "payment", payee: { email: null, merchantId: "merch123", name: null } }).decision).toBe("within");
  });
  it("violates for anyone else", () => {
    expect(check([allow], { kind: "payment", payee: { email: "eve@example.com", merchantId: null, name: null } }).decision).toBe("outside");
  });
  it("asks when a payment names no payee", () => {
    expect(check([allow], { kind: "payment", payee: null }).decision).toBe("ask");
  });
  it("checks every payout receiver", () => {
    const payout = (emails: string[]): Partial<Proposal> => ({
      kind: "payout",
      amount: money(emails.length * 10),
      items: emails.map((e) => item({ title: "pay", unitPrice: money("10"), facts: facts({ category: "payout", attributes: { payee: e } }) })),
    });
    expect(check([allow], payout(["sam@example.com"])).decision).toBe("within");
    const v = check([allow], payout(["sam@example.com", "eve@example.com"]));
    expect(v.decision).toBe("outside");
    expect(v.violations).toHaveLength(1);
    expect(v.violations[0].message).toContain("eve@example.com");
  });
});

describe("guard: require_evidence", () => {
  const ev: Clause = { id: "c6", kind: "require_evidence", label: "Photo of the delivery", evidence: "delivery_photo", rubric: "box at door" };
  const ref = (verdict: "pass" | "fail" | "unknown") => ({ kind: "delivery_photo" as const, verdict, detail: "photo check", ref: null });
  it("passes with a passing ref", () => {
    expect(check([ev], { kind: "payout", evidence: [ref("pass")], items: [] }).decision).toBe("within");
  });
  it("violates on fail", () => {
    expect(check([ev], { evidence: [ref("fail")] }).decision).toBe("outside");
  });
  it("asks when missing or unknown", () => {
    expect(check([ev], { evidence: [] }).decision).toBe("ask");
    expect(check([ev], { evidence: [ref("unknown")] }).decision).toBe("ask");
    expect(check([ev], { evidence: [{ ...ref("pass"), kind: "tracking" }] }).decision).toBe("ask");
  });
});

describe("guard: rate_card", () => {
  const rate: Clause = { id: "c7", kind: "rate_card", label: "5 cents a fetch", unit: "fetch", price: money("0.05") };
  it("checks every item unit price", () => {
    expect(check([rate], { kind: "metered_charge", items: [item({ unitPrice: money("0.05") })] }).decision).toBe("within");
    expect(check([rate], { kind: "metered_charge", items: [item({ unitPrice: money("0.06") })] }).decision).toBe("outside");
  });
  it("checks the amount of an item-less metered charge", () => {
    expect(check([rate], { kind: "metered_charge", items: [], amount: money("0.07") }).decision).toBe("outside");
  });
  it("does not cap a settlement payout per fetch", () => {
    const p: Partial<Proposal> = {
      kind: "payout",
      amount: money("3.20"),
      items: [item({ unitPrice: money("3.20"), facts: facts({ attributes: { payee: "site@example.com" } }) })],
    };
    expect(check([rate], p).decision).toBe("within");
  });
});

describe("guard: split_rule", () => {
  const split: Clause = {
    id: "c8",
    kind: "split_rule",
    label: "70/30 split",
    splits: [
      { payee: "a@example.com", weightBps: 7000 },
      { payee: "b@example.com", weightBps: 3000 },
    ],
  };
  const payout = (pairs: Array<[string, string]>): Partial<Proposal> => ({
    kind: "payout",
    items: pairs.map(([email, v]) => item({ title: "share", unitPrice: money(v), facts: facts({ category: "payout", attributes: { payee: email } }) })),
  });
  it("passes when every receiver gets their share", () => {
    expect(check([split], payout([["a@example.com", "7.00"], ["b@example.com", "3.00"]])).decision).toBe("within");
  });
  it("violates when a share is off by more than a cent", () => {
    const v = check([split], payout([["a@example.com", "6.00"], ["b@example.com", "4.00"]]));
    expect(v.decision).toBe("outside");
    expect(v.violations.length).toBe(2);
  });
  it("violates when a receiver has no share", () => {
    expect(check([split], payout([["c@example.com", "10.00"]])).decision).toBe("outside");
  });
  it("violates when weights do not add to 100%", () => {
    const bad: Clause = { ...split, splits: [{ payee: "a@example.com", weightBps: 5000 }] };
    const v = check([bad], { kind: "purchase" });
    expect(v.decision).toBe("outside");
    expect(v.violations[0].message).toContain("50%");
  });
});

describe("guard: expires_at", () => {
  const exp: Clause = { id: "c9", kind: "expires_at", label: "Good for 3 days", at: "2026-11-11T12:00:00.000Z" };
  it("passes before the end", () => {
    expect(check([exp]).decision).toBe("within");
  });
  it("violates after the end", () => {
    expect(check([exp], {}, { spent: money("0"), now: new Date("2026-11-11T12:00:01.000Z") }).decision).toBe("outside");
  });
});

describe("guard: integrity and precedence", () => {
  it("flags injection as an integrity violation", () => {
    const v = check([BUDGET_50], { items: [item({ facts: facts({ injectionSuspected: true }) })] });
    expect(v.decision).toBe("outside");
    expect(v.violations[0]).toEqual({ clauseId: INTEGRITY_CLAUSE_ID, message: INTEGRITY_MESSAGE });
  });
  it("outside beats ask, ask beats within", () => {
    const cat: Clause = { id: "c2", kind: "category_in", label: "Toys", categories: ["toys"] };
    const v = check([BUDGET_50, cat], { amount: money("60"), items: [item({ facts: facts({ category: null }) })] });
    expect(v.decision).toBe("outside");
    expect(v.unknowns).toHaveLength(1);
    expect(check([cat], { items: [item({ facts: facts({ category: null }) })] }).decision).toBe("ask");
  });
  it("is deterministic and stamps checkedAt from ctx.now", () => {
    const a = check([BUDGET_50]);
    const b = check([BUDGET_50]);
    expect(a).toEqual(b);
    expect(a.checkedAt).toBe(now.toISOString());
  });
});
