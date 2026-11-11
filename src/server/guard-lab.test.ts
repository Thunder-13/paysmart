import { describe, expect, it } from "vitest";
import { guard } from "@/core/guard";
import { INTEGRITY_CLAUSE_ID } from "@/core/contracts";
import { createTestRuntime } from "@/core/testing";
import { seedDemoStory, type DemoRuntime } from "./demo-seed";
import { featuredRuns } from "./featured-runs";
import { guardLab } from "./guard-lab";

process.env.TOLL_ROAD_MOCK_DELAY_MS = "0";

describe("guardLab", () => {
  it("returns null on an empty runtime", () => {
    const rt = createTestRuntime();
    expect(guardLab(rt, null)).toBeNull();
  });

  it("replays the stored verdict through the real guard and drops the email", async () => {
    const rt = createTestRuntime();
    await seedDemoStory(rt as unknown as DemoRuntime);
    const lab = guardLab(rt, featuredRuns(rt).shop?.runId ?? null);
    expect(lab).not.toBeNull();
    if (!lab) return;
    expect(lab.slip.principal.email).toBeNull();
    expect(lab.stored.decision).toBe("outside");
    expect(lab.spent.value).toBe("0.00");
    const again = guard(lab.slip, lab.proposal, { spent: lab.spent, now: new Date(lab.now) });
    expect(again.decision).toBe(lab.stored.decision);
    expect(again.violations.map((v) => v.clauseId)).toEqual(lab.stored.violations.map((v) => v.clauseId));
    expect(again.violations.some((v) => v.clauseId === INTEGRITY_CLAUSE_ID)).toBe(true);
  });

  it("drops the integrity violation when the injection flag is cleared", async () => {
    const rt = createTestRuntime();
    await seedDemoStory(rt as unknown as DemoRuntime);
    const lab = guardLab(rt, null)!;
    const items = lab.proposal.items.map((i) => ({ ...i, facts: { ...i.facts, injectionSuspected: false } }));
    const v = guard(lab.slip, { ...lab.proposal, items }, { spent: lab.spent, now: new Date(lab.now) });
    expect(v.violations.some((x) => x.clauseId === INTEGRITY_CLAUSE_ID)).toBe(false);
  });
});
