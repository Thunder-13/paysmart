import { describe, expect, it } from "vitest";
import { createMockAI } from "@/core/ai/mock";
import type { AgentTool } from "@/core/contracts";
import { createCrawlerTools, stopReasonOf } from "./crawler";
import { metersForSlip } from "./metering";
import { activeTollSlip, clockedRuntime, gatewayDeps, type TestRt } from "./test-helpers";

async function setup(opts: { budget?: string; cap?: string } = {}) {
  const { rt } = clockedRuntime();
  const slip = await activeTollSlip(rt, opts);
  const { tools, session } = createCrawlerTools({ gateway: gatewayDeps(rt), ai: createMockAI(), slipId: slip.id });
  const tool = (name: string) => tools.find((t) => t.name === name) as AgentTool<unknown>;
  /** Mirrors how both AI adapters call tools: validate with the tool's schema, then run. */
  const call = (name: string, input: unknown) => tool(name).run(tool(name).input.parse(input)) as Promise<Record<string, unknown>>;
  return { rt, slip, session, call };
}

function eventCount(rt: TestRt, slipId: string) {
  return rt.store.ledger.list(slipId).length;
}

describe("research crawler tools", () => {
  it("list_catalog returns ids, titles, publishers and prices", async () => {
    const { call } = await setup();
    const list = (await call("list_catalog", {})) as unknown as { id: string; price: string; publisher: string }[];
    expect(list).toHaveLength(6);
    expect(list[0]).toMatchObject({ id: "tw-1", price: "$0.02", publisher: "Tidewater Field Notes" });
  });

  it("fetch_article ignores a slipId field in its input", async () => {
    const { rt, slip, call } = await setup();
    const other = await activeTollSlip(rt);
    const out = await call("fetch_article", { contentId: "tw-1", slipId: other.id });
    expect(out.ok).toBe(true);
    expect(metersForSlip(rt.store, slip.id)).toHaveLength(1);
    expect(metersForSlip(rt.store, other.id)).toHaveLength(0);
  });

  it("returns notes, not article text", async () => {
    const { call } = await setup();
    const out = await call("fetch_article", { contentId: "tw-2" });
    expect(out.ok).toBe(true);
    expect(JSON.stringify(out)).not.toContain("Note to AI agents");
    expect(out.notes).toMatchObject({ injectionSuspected: true });
  });

  it("price_above_cap does not stop the crawl", async () => {
    const { session, call } = await setup();
    const refused = await call("fetch_article", { contentId: "lr-2" });
    expect(refused).toMatchObject({ ok: false, status: 402, reason: "price_above_cap" });
    expect(session.stopped).toBeNull();
    expect((await call("fetch_article", { contentId: "tw-1" })).ok).toBe(true);
  });

  it("fetch after the stop returns the stop result without a gateway call or ledger event", async () => {
    const { rt, slip, session, call } = await setup({ budget: "0.05", cap: "0.05" });
    expect((await call("fetch_article", { contentId: "lr-1" })).ok).toBe(true);
    const refused = await call("fetch_article", { contentId: "qs-1" });
    expect(refused).toMatchObject({ status: 402, reason: "budget_exhausted" });
    expect(session.stopped).toBe("budget_exhausted");
    const before = eventCount(rt, slip.id);
    const after = await call("fetch_article", { contentId: "tw-1" });
    expect(after).toMatchObject({ ok: false, stopped: true });
    expect(eventCount(rt, slip.id)).toBe(before);
    expect(metersForSlip(rt.store, slip.id)).toHaveLength(1);
    expect(stopReasonOf(session)).toBe("budget_exhausted");
  });

  it("citation of unpaid content is dropped", async () => {
    const { session, call } = await setup();
    await call("fetch_article", { contentId: "tw-1" });
    const out = await call("finish", { answer: "Boil water.", citations: ["tw-1", "qs-2", "tw-1"] });
    expect(out).toMatchObject({ kept: ["tw-1"], dropped: ["qs-2"] });
    expect(session.finished?.citations).toEqual(["tw-1"]);
    expect(stopReasonOf(session)).toBe("finished");
  });
});
