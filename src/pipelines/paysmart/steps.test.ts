import { describe, expect, it, vi } from "vitest";
import { money } from "@/core/money";
import { discoverNeed } from "./discover";
import { mockRoute } from "./router";
import { createPaySmartSteps } from "./steps";
import { events, paysmartRuntime, railCalls, runToChoose, state, stepContext, waitData } from "./test-utils";
import { PAYSMART_DEMO_ASK, PAYSMART_EXAMPLES } from "./types";

describe("front door", () => {
  const targets = ["/p/second-look", "/p/bounty", "/p/cash-weather", "/p/toll-road", "/p/dispute-desk"];
  it.each(PAYSMART_EXAMPLES.slice(1).map((e, i) => [e.label, e.ask, targets[i]] as const))("hands off %s with no slip and no PayPal call", async (_l, ask, path) => {
    const rt = paysmartRuntime();
    const run = await rt.orchestrator.start("paysmart", { ask });
    expect(run.status).toBe("done");
    expect(state(run).outcome).toBe("handed_off");
    expect(state(run).handoff?.path).toBe(path);
    expect(run.slipId).toBeNull();
    expect(railCalls(rt)).toHaveLength(0);
  });

  it("quotes the scam lines in the Second Look handoff", async () => {
    const rt = paysmartRuntime();
    const run = await rt.orchestrator.start("paysmart", { ask: PAYSMART_EXAMPLES[1].ask });
    expect(state(run).handoff?.quotes.join(" ")).toMatch(/friends and family/i);
  });

  it("a voice ask reaches the same choose wait as the typed demo ask", async () => {
    const typed = await runToChoose(paysmartRuntime());
    const rt = paysmartRuntime();
    const voice = await runToChoose(rt, { askVia: "voice" });
    expect(state(voice).askVia).toBe("voice");
    const summary = (r: typeof voice) =>
      (waitData(r).options as { id: string; proposal: { amount: unknown }; lines: { listingId: string }[] }[]).map((o) => [o.id, o.proposal.amount, o.lines.map((l) => l.listingId)]);
    expect(summary(voice)).toEqual(summary(typed));
    expect(summary(voice).map((x) => (x[1] as { value: string }).value)).toEqual(["47.17", "26.39"]);
    expect(waitData(voice).funnel).toEqual(waitData(typed).funnel);
    expect(events(rt, voice.slipId, "paysmart.routed")[0].data).toMatchObject({ askVia: "voice" });
  });

  it("records the route with askVia in the ledger once the slip exists", async () => {
    const rt = paysmartRuntime();
    const run = await rt.orchestrator.start("paysmart", { askVia: "voice" });
    const routed = events(rt, run.slipId, "paysmart.routed");
    expect(routed).toHaveLength(1);
    expect(routed[0].data).toMatchObject({ askVia: "voice", useCase: "buy" });
    expect(String((routed[0].data as { message: string }).message)).toMatch(/spoken/);
  });
});

describe("clarify", () => {
  it("asks for a limit before any search, then continues on a fresh slip", async () => {
    const rt = paysmartRuntime();
    let run = await rt.orchestrator.start("paysmart", { ask: "A birthday card for my aunt." });
    expect(run.step).toBe("clarify");
    expect(waitData(run)).toMatchObject({ stage: "clarify", question: "How much can you spend in total?", round: 1 });
    expect(state(run).searches).toHaveLength(0);
    expect(railCalls(rt)).toHaveLength(0);
    const first = run.slipId!;
    run = await rt.orchestrator.resume(run.id, { answer: "$15" });
    expect(run.step).toBe("choose");
    expect(run.slipId).not.toBe(first);
    expect(rt.store.slips.get(first)?.status).toBe("rejected");
    expect(rt.store.slips.get(run.slipId!)?.clauses[0]).toMatchObject({ kind: "budget_max", amount: money("15") });
  });

  it("ends blocked with the last question after 2 unanswered rounds", async () => {
    const rt = paysmartRuntime();
    let run = await rt.orchestrator.start("paysmart", { ask: "A birthday card for my aunt." });
    run = await rt.orchestrator.resume(run.id, { answer: "whatever you think" });
    expect(run.step).toBe("clarify");
    run = await rt.orchestrator.resume(run.id, { answer: "surprise me" });
    expect(run.status).toBe("done");
    expect(state(run).outcome).toBe("blocked");
    expect(state(run).note).toBe("How much can you spend in total?");
    expect(railCalls(rt)).toHaveLength(0);
  });

  it("sends a limit over the cap back with the cap in the question", async () => {
    const rt = paysmartRuntime();
    const run = await rt.orchestrator.start("paysmart", { ask: "A birthday card for my aunt, under $5000." });
    expect(run.step).toBe("clarify");
    expect(String(run.wait?.message)).toMatch(/\$1,000\.00/);
  });

  it("re-waits on a bad signal and cancels cleanly", async () => {
    const rt = paysmartRuntime();
    let run = await rt.orchestrator.start("paysmart", { ask: "A birthday card for my aunt." });
    run = await rt.orchestrator.resume(run.id, { nonsense: 1 });
    expect(run.status).toBe("waiting");
    expect(String(run.wait?.message)).toMatch(/Type an answer/);
    run = await rt.orchestrator.resume(run.id, { cancel: true });
    expect(state(run).outcome).toBe("cancelled");
  });

  it("fails the request screen when the compiled slip allows gift cards the ask never named", async () => {
    const rt = paysmartRuntime();
    const json = rt.ai.json.bind(rt.ai);
    vi.spyOn(rt.ai, "json").mockImplementation(async (req) => {
      const out = await json(req);
      if (req.label !== "compile-slip") return out;
      const c = out as unknown as { clauses: { kind: string; categories?: string[] }[] };
      return { ...c, clauses: c.clauses.map((x) => (x.kind === "category_in" ? { ...x, categories: ["toy", "gift_card"] } : x)) } as typeof out;
    });
    const run = await rt.orchestrator.start("paysmart", {});
    expect(run.status).toBe("waiting");
    expect(run.step).toBe("clarify");
    expect(waitData(run).stage).toBe("clarify");
    expect(String(run.wait?.message)).toMatch(/gift cards/);
    expect(state(run).requestScreen.some((r) => r.status === "fail")).toBe(true);
    expect(state(run).searches).toEqual([]);
    expect(railCalls(rt)).toHaveLength(0);
  });

  it("asks what to look for when a buy ask has no needs", async () => {
    const rt = paysmartRuntime();
    const run = await rt.orchestrator.start("paysmart", { ask: "Under $20 by Friday." });
    expect(run.step).toBe("clarify");
    expect(waitData(run).question).toBe("What should I look for?");
  });
});

describe("discover", () => {
  it("runs one search per need and saves state after each (direct step calls)", async () => {
    const rt = paysmartRuntime();
    const route = mockRoute(PAYSMART_DEMO_ASK);
    const slip = rt.core.createSlip({
      pipeline: "paysmart",
      principal: { name: "Ada", email: null },
      intent: PAYSMART_DEMO_ASK,
      clauses: [{ id: "c1", kind: "budget_max", label: "Spend at most $60.00", amount: money("60.00") }],
      budget: money("60.00"),
      expiresAt: "2026-11-11T18:00:00.000Z",
    });
    const steps = createPaySmartSteps({ channel3ApiKey: () => null });
    let ctx = stepContext(rt, { route }, slip.id);
    const first = await steps.discover(ctx);
    expect(first).toMatchObject({ next: "discover", state: { discoverCursor: 1 } });
    const afterFirst = (first as { state: { searches: { need: string; found: number }[] } }).state;
    expect(afterFirst.searches).toHaveLength(1);
    expect(afterFirst.searches[0]).toMatchObject({ id: "s-1", need: "dinosaur gift", found: 9 });

    ctx = stepContext(rt, { route, ...(first as { state: object }).state }, slip.id);
    const second = await steps.discover(ctx);
    expect(second).toMatchObject({ next: "assemble", state: { discoverCursor: 2 } });
    expect((second as { state: { searches: unknown[] } }).state.searches).toHaveLength(2);
    expect(events(rt, slip.id, "paysmart.search")).toHaveLength(2);
    expect(await steps.discover(stepContext(rt, { route, discoverCursor: 2 }, slip.id))).toEqual({ next: "assemble" });
  });

  it("a direct discoverNeed keeps a listing's first need and falls back to fixtures on a Channel3 error", async () => {
    const rt = paysmartRuntime();
    const route = mockRoute(PAYSMART_DEMO_ASK);
    const slip = rt.core.createSlip({
      pipeline: "paysmart",
      principal: { name: "Ada", email: null },
      intent: PAYSMART_DEMO_ASK,
      clauses: [{ id: "c1", kind: "budget_max", label: "Spend at most $60.00", amount: money("60.00") }],
      budget: money("60.00"),
      expiresAt: "2026-11-11T18:00:00.000Z",
    });
    const failing = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
    const ctx = stepContext(rt, { route }, slip.id);
    const patch = await discoverNeed(ctx, { apiKey: "key", fetch: failing }, slip, 0);
    expect(patch.searches?.[0].source).toBe("fixtures");
    const ev = events(rt, slip.id, "paysmart.search")[0].data as { message: string; fellBack: string | null };
    expect(ev.fellBack).toBeTruthy();
    expect(ev.message).toMatch(/Channel3 failed/);
  });

  it("the full run records one SearchRun per need with plain-words ledger messages", async () => {
    const rt = paysmartRuntime();
    const run = await runToChoose(rt);
    expect(state(run).searches.map((s) => [s.id, s.need, s.found, s.ruledOut, s.shown, s.inspected])).toEqual([
      ["s-1", "dinosaur gift", 9, 1, 8, 5],
      ["s-2", "birthday card", 2, 0, 2, 2],
    ]);
    const msgs = events(rt, run.slipId, "paysmart.search").map((e) => (e.data as { message: string }).message);
    expect(msgs[0]).toMatch(/^Searched the sample catalog for "dinosaur gift" \(dinosaur gift\)/);
    expect(msgs[0]).toMatch(/9 found, 1 dropped by screens, 8 shown/);
  });
});

describe("choose", () => {
  it("decline makes zero PayPal rail calls", async () => {
    const rt = paysmartRuntime();
    let run = await runToChoose(rt);
    expect(railCalls(rt)).toHaveLength(0);
    run = await rt.orchestrator.resume(run.id, { approved: false });
    expect(run.status).toBe("done");
    expect(state(run).outcome).toBe("cancelled");
    expect(railCalls(rt)).toHaveLength(0);
    expect(rt.store.slips.get(run.slipId!)?.status).toBe("rejected");
  });

  it("re-waits on a bad signal and on a forged option id, with no rail calls", async () => {
    const rt = paysmartRuntime();
    let run = await runToChoose(rt);
    run = await rt.orchestrator.resume(run.id, { nonsense: 1 });
    expect(run.status).toBe("waiting");
    expect(String(run.wait?.message)).toMatch(/Pick an option or decline\./);
    run = await rt.orchestrator.resume(run.id, { approved: true, optionId: "opt-99" });
    expect(run.step).toBe("choose");
    expect(String(run.wait?.message)).toMatch(/That option is not on the list/);
    expect(railCalls(rt)).toHaveLength(0);
  });

  it("a clause edit re-stamps products and options with no new search", async () => {
    const rt = paysmartRuntime();
    let run = await runToChoose(rt);
    const searchesBefore = events(rt, run.slipId, "paysmart.search").length;
    const clauses = (waitData(run).clauses as { id: string; kind: string; amount?: unknown }[]).map((c) =>
      c.kind === "budget_max" ? { ...c, amount: money("30.00") } : c,
    );
    run = await rt.orchestrator.resume(run.id, { approved: true, clauses });
    expect(run.step).toBe("choose");
    const s = state(run);
    expect(s.options.map((o) => o.proposal.amount.value)).toEqual(["26.39"]);
    expect(s.ruledOut.map((r) => r.amount.value)).toEqual(["48.68", "47.17"]);
    expect(s.ruledOut[1].clauseIds).toEqual(["c1"]);
    expect(events(rt, run.slipId, "paysmart.clauses_edited")).toHaveLength(1);
    expect(events(rt, run.slipId, "paysmart.search")).toHaveLength(searchesBefore);
    const rex = s.products.find((p) => p.listingId === "fx-clockwork-rex")!;
    expect(rex.status).toBe("ruled_out");
    expect(rex.screens.find((x) => x.screen === "slip")?.clauseIds).toEqual(["c1"]);
    expect(railCalls(rt)).toHaveLength(0);
  });

  it("re-waits with the problem when edited clauses are malformed", async () => {
    const rt = paysmartRuntime();
    let run = await runToChoose(rt);
    run = await rt.orchestrator.resume(run.id, { approved: true, clauses: [{ nonsense: true }] });
    expect(run.step).toBe("choose");
    expect(String(run.wait?.message)).toMatch(/malformed/);
  });
});

describe("no options", () => {
  it("ends no_options with the top reasons and a rejected slip", async () => {
    const rt = paysmartRuntime();
    const run = await rt.orchestrator.start("paysmart", { ask: "A birthday card for my aunt. Under $3." });
    expect(run.status).toBe("done");
    expect(state(run).outcome).toBe("no_options");
    expect(state(run).note).toMatch(/No cart fit your slip/);
    expect(rt.store.slips.get(run.slipId!)?.status).toBe("rejected");
    expect(railCalls(rt)).toHaveLength(0);
  });
});
