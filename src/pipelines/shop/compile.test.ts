import { describe, expect, it } from "vitest";
import type { Clause } from "@/core/contracts";
import { money } from "@/core/money";
import { normalizeCompiledSlip } from "@/core/services";
import { amountFromIntent, mockCompile, slipProblem, validateClauseEdits } from "./compile";
import { DEMO_INTENT } from "./types";

const NOW = new Date("2026-11-08T18:00:00.000Z");

describe("mock compiler", () => {
  it("turns the demo intent into c1..c6 in order", () => {
    const slip = normalizeCompiledSlip(mockCompile(DEMO_INTENT, NOW), NOW);
    expect(slip.budget).toEqual(money("60.00"));
    expect(slip.clauses.map((c) => `${c.id}:${c.kind}`)).toEqual([
      "c1:budget_max",
      "c2:quantity_max",
      "c3:category_in",
      "c4:deliver_by",
      "c5:exclude_attribute",
      "c6:expires_at",
    ]);
    const c4 = slip.clauses[3] as Extract<Clause, { kind: "deliver_by" }>;
    expect(c4.date).toBe("2026-11-14");
    const c5 = slip.clauses[4] as Extract<Clause, { kind: "exclude_attribute" }>;
    expect(c5.label).toBe("Nothing that needs batteries");
    const c6 = slip.clauses[5] as Extract<Clause, { kind: "expires_at" }>;
    expect(c6.at).toBe("2026-11-11T18:00:00.000Z");
    expect(slip.summary).toMatch(/^One toy or gift for up to \$60\.00/);
  });

  it("asks for a limit when the intent names no amount", () => {
    const slip = normalizeCompiledSlip(mockCompile("A dinosaur toy for Leo", NOW), NOW);
    expect(amountFromIntent("A dinosaur toy for Leo")).toEqual(money("0.00"));
    expect(slipProblem(slip.clauses, slip.budget)).toMatch(/spending limit/);
  });
});

describe("clause edits", () => {
  const current = normalizeCompiledSlip(mockCompile(DEMO_INTENT, NOW), NOW).clauses;

  it("accepts a lower budget and relabels it", () => {
    const edited = current.map((c) => (c.kind === "budget_max" ? { ...c, amount: money("50.00") } : c));
    const v = validateClauseEdits(current, edited);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.budget).toEqual(money("50.00"));
    expect(v.clauses[0].label).toBe("Spend at most $50.00");
    expect(v.changed).toBe(true);
  });

  it("rejects two budgets and malformed clauses", () => {
    const two = [...current, { id: "c9", kind: "budget_max", label: "x", amount: money("10.00") }];
    expect(validateClauseEdits(current, two)).toMatchObject({ ok: false, error: expect.stringMatching(/exactly one spending limit/) });
    const bad = [...current, { id: "c9", kind: "quantity_max", label: "x", count: -2 }];
    expect(validateClauseEdits(current, bad)).toMatchObject({ ok: false, error: expect.stringMatching(/malformed/) });
    const zero = current.map((c) => (c.kind === "budget_max" ? { ...c, amount: money("0.00") } : c));
    expect(validateClauseEdits(current, zero)).toMatchObject({ ok: false });
  });
});
