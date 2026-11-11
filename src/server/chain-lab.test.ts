import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyChainWeb, type WebLedgerEvent } from "@/core/store/browser-hash";
import { createTestRuntime } from "@/core/testing";
import { chainLab } from "./chain-lab";
import { loadDemoStory } from "./demo-seed";
import { featuredRuns } from "./featured-runs";
import { heroBoard } from "./hero-board";

const dir = mkdtempSync(path.join(tmpdir(), "permission-slip-chainlab-"));
const KEY = "__permissionSlipRuntime";

beforeAll(() => {
  Object.assign(process.env, { PAYPAL_MODE: "mock", AI_MODE: "mock", DATA_DIR: dir, TOLL_ROAD_MOCK_DELAY_MS: "0" });
  for (const k of ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "ANTHROPIC_API_KEY", "CHANNEL3_API_KEY"]) delete process.env[k];
});

afterAll(() => {
  delete (globalThis as Record<string, unknown>)[KEY];
  rmSync(dir, { recursive: true, force: true });
});

describe("chainLab", () => {
  it("is null on an empty ledger", () => {
    expect(chainLab(createTestRuntime({ seedRail: false }), null)).toBeNull();
  });

  it("returns the hero slip's chain and the browser verifies it after a JSON round trip", async () => {
    delete (globalThis as Record<string, unknown>)[KEY];
    const rt = await import("./runtime").then((m) => m.getRuntime());
    await loadDemoStory(rt);
    const shop = featuredRuns(rt).shop;
    const lab = chainLab(rt, shop?.runId ?? null);
    expect(lab).not.toBeNull();
    expect(lab!.slipId).toBe(heroBoard(rt, shop?.runId ?? null)!.slip.id);
    expect(lab!.events.length).toBeGreaterThan(10);
    expect(lab!.events.length).toBeLessThanOrEqual(80);
    expect(lab!.events.map((e) => e.seq)).toEqual(lab!.events.map((_, i) => i + 1));
    expect(lab!.events.some((e) => e.type === "rail.captured")).toBe(true);
    const wire = JSON.parse(JSON.stringify(lab!.events)) as WebLedgerEvent[];
    const res = await verifyChainWeb(wire);
    expect(res.ok).toBe(true);
    expect(res.links.every((l) => l.status === "ok")).toBe(true);
    expect(rt.store.ledger.verifyChain(lab!.slipId).ok).toBe(true);
  });
});
