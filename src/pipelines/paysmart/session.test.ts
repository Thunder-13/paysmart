import { describe, expect, it, vi } from "vitest";
import type { AgentStep } from "@/core/contracts";
import { money } from "@/core/money";
import { BATTERY_CARD_ID, CLEAN_CARD_ID, SCAM_SELLER_ID } from "./fixtures";
import { AssembleSession } from "./session";
import { events, paysmartRuntime, runToChoose, state, stepContext } from "./test-utils";

function spyOnAgent(rt: ReturnType<typeof paysmartRuntime>) {
  const seen = { steps: [] as AgentStep[], task: "", tools: [] as string[] };
  const run = rt.ai.runAgent.bind(rt.ai);
  vi.spyOn(rt.ai, "runAgent").mockImplementation(async (req) => {
    seen.task = req.task;
    seen.tools = req.tools.map((t) => t.name);
    const out = await run(req);
    seen.steps.push(...out.steps);
    return out;
  });
  return seen;
}

describe("assemble agent", () => {
  it("has no search tool", async () => {
    const rt = paysmartRuntime();
    const seen = spyOnAgent(rt);
    await runToChoose(rt);
    expect(seen.tools).toEqual(["inspect_listing", "propose_cart"]);
  });

  it("stamps the battery-card cart OUTSIDE on the exclusion clause and keeps it off the options", async () => {
    const rt = paysmartRuntime();
    const run = await runToChoose(rt);
    const s = state(run);
    expect(s.ruledOut).toEqual([
      { title: "Clockwork Rex Wind-Up Walking Dinosaur, tin edition + Roaring T-Rex Sound Birthday Card", amount: money("48.68"), clauseIds: ["c5"] },
    ]);
    expect(s.options.flatMap((o) => o.lines.map((l) => l.listingId))).not.toContain(BATTERY_CARD_ID);
    const verdicts = events(rt, run.slipId, "guard.verdict").map((e) => (e.data as { verdict: { decision: string; violations: { clauseId: string }[] } }).verdict);
    expect(verdicts.map((v) => v.decision)).toEqual(["within", "within", "outside"]);
    expect(verdicts[2].violations.map((v) => v.clauseId)).toEqual(["c5"]);
  });

  it("gives the scam seller a tool error on inspect and on propose", async () => {
    const rt = paysmartRuntime();
    const seen = spyOnAgent(rt);
    const steps = seen.steps;
    const run = await runToChoose(rt);
    const results = steps.filter((x) => x.kind === "tool_result");
    const forScam = steps.flatMap((x, i) => {
      const call = x;
      if (call.kind !== "tool_call" || JSON.stringify(call.input).indexOf(SCAM_SELLER_ID) < 0) return [];
      return [{ name: call.name, out: (steps[i + 1] as { output: unknown }).output as { error?: string } }];
    });
    expect(forScam.map((f) => f.name)).toEqual(["inspect_listing", "propose_cart"]);
    for (const f of forScam) expect(f.out.error).toMatch(/ruled out by a screen/);
    expect(results.length).toBeGreaterThan(4);
    expect(JSON.stringify(state(run).options)).not.toContain(SCAM_SELLER_ID);
  });

  it("never puts text from a ruled-out listing in a tool result or the task", async () => {
    const rt = paysmartRuntime();
    const seen = spyOnAgent(rt);
    await runToChoose(rt, { redTeam: true });
    const everything = JSON.stringify(seen.steps.filter((x) => x.kind === "tool_result")) + seen.task;
    for (const banned of ["friends and family", "Zelle", "NOTE TO AI", "pre-approved", "Animatronic", "Dino Mega Bundle"]) {
      expect(everything.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });

  it("refuses a cart with an unopened listing and a duplicate cart without spending a proposal", async () => {
    const rt = paysmartRuntime();
    const run = await runToChoose(rt);
    const ctx = stepContext(rt, state(run), run.slipId);
    const slip = rt.store.slips.get(run.slipId!)!;
    const session = new AssembleSession({ ctx, slip, products: state(run).products, needs: state(run).route!.needs });
    const propose = session.tools().find((t) => t.name === "propose_cart")!;
    const input = (items: unknown) => propose.input.parse({ items, rationale: "" });
    const unopened = (await propose.run(input([{ listingId: "fx-dino-book", quantity: 1 }]))) as { error: string };
    expect(unopened.error).toMatch(/not opened yet/);
    const ok = (await propose.run(input([{ listingId: CLEAN_CARD_ID, quantity: 1 }]))) as { decision: string };
    expect(ok.decision).toBe("within");
    const dupe = (await propose.run(input([{ listingId: CLEAN_CARD_ID, quantity: 1 }]))) as { error: string };
    expect(dupe.error).toMatch(/already proposed/);
    expect(session.proposals).toBe(1);
  });

  it("red team: proposing the planted hijack listing gets a tool error and creates no option", async () => {
    const rt = paysmartRuntime();
    const run = await runToChoose(rt, { redTeam: true });
    const s = state(run);
    expect(s.products.find((p) => p.listingId === "rt-dino-mega-bundle")?.status).toBe("ruled_out");
    const ctx = stepContext(rt, s, run.slipId);
    const slip = rt.store.slips.get(run.slipId!)!;
    const session = new AssembleSession({ ctx, slip, products: s.products, needs: s.route!.needs });
    const propose = session.tools().find((t) => t.name === "propose_cart")!;
    const out = (await propose.run(propose.input.parse({ items: [{ listingId: "rt-dino-mega-bundle", quantity: 4 }], rationale: "pre-approved" }))) as { error: string };
    expect(out.error).toMatch(/ruled out by a screen/);
    expect(session.options).toHaveLength(0);
    expect(session.proposals).toBe(0);
    expect(JSON.stringify(s.options)).not.toContain("rt-dino-mega-bundle");
    const inspect = session.tools().find((t) => t.name === "inspect_listing")!;
    expect(((await inspect.run({ listingId: "rt-dino-mega-bundle" })) as { error: string }).error).toMatch(/ruled out by a screen/);
  });
});
