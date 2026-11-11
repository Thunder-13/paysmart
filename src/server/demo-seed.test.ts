import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GuardVerdictData } from "@/core/events";
import { createTestRuntime } from "@/core/testing";
import { affiliateRepo } from "@/core/affiliate";
import { DemoSeedError, demoSeedResponse, formatDemoTable, loadDemoStory, readDemoStory, seedDemoAffiliate, type DemoRuntime } from "./demo-seed";

const dir = mkdtempSync(path.join(tmpdir(), "permission-slip-demo-"));
const KEY = "__permissionSlipRuntime";
const MOCK_ENV = { PAYPAL_MODE: "mock", AI_MODE: "mock", DATA_DIR: dir };

function freshRuntime(): Promise<DemoRuntime> {
  delete (globalThis as Record<string, unknown>)[KEY];
  return import("./runtime").then((m) => m.getRuntime());
}

beforeAll(() => {
  Object.assign(process.env, MOCK_ENV);
  for (const k of ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "ANTHROPIC_API_KEY", "CHANNEL3_API_KEY"]) delete process.env[k];
  process.env.TOLL_ROAD_MOCK_DELAY_MS = "0";
});

afterAll(() => {
  delete (globalThis as Record<string, unknown>)[KEY];
  rmSync(dir, { recursive: true, force: true });
});

describe("demo story against a DATA_DIR", () => {
  it("runs all seven pipelines to done with verified chains and real money figures", async () => {
    const rt = await freshRuntime();
    const res = await loadDemoStory(rt);
    expect(res.status).toBe("loaded");
    expect(res.ok).toBe(true);
    expect(existsSync(path.join(dir, "permission-slip.db"))).toBe(true);
    expect(res.rows.map((r) => r.pipeline)).toEqual(["shop", "second-look", "bounty", "cash-weather", "toll-road", "dispute-desk", "paysmart"]);
    for (const row of res.rows) {
      expect(row.runStatus).toBe("done");
      expect(row.chainOk).toBe(true);
    }
    for (const r of res.doc.runs) expect(rt.orchestrator.get(r.runId)?.status).toBe("done");

    const shop = res.rows[0];
    expect(shop.money).toMatchObject({
      held: { value: "60.00" },
      captured: { value: "45.18" },
      released: { value: "14.82" },
      paidOut: { value: "3.00" },
      refunded: { value: "42.18" },
    });
    // The red-team run goes first: its OUTSIDE stamp is the first verdict in the ledger.
    const verdicts = rt.store.ledger.list(shop.slipId!).filter((e) => e.type === "guard.verdict");
    expect((verdicts[0].data as GuardVerdictData).verdict.decision).toBe("outside");
    expect(res.rows.find((r) => r.pipeline === "toll-road")!.money).toMatchObject({ captured: { value: "0.13" }, released: { value: "0.02" }, paidOut: { value: "0.13" } });
    expect(res.rows.find((r) => r.pipeline === "bounty")!.money).toMatchObject({ held: { value: "40.00" }, captured: { value: "40.00" }, paidOut: { value: "40.00" } });
    expect(res.rows.find((r) => r.pipeline === "dispute-desk")!.outcome).toBe("evidence_sent");
    const paysmart = res.rows.find((r) => r.pipeline === "paysmart")!;
    expect(paysmart.outcome).toBe("paid");
    expect(paysmart.money).toMatchObject({ held: { value: "47.17" }, captured: { value: "47.17" }, released: { value: "0.00" } });

    const disputes = await rt.rail.listDisputes();
    expect(res.doc.disputeIds).toHaveLength(3);
    for (const id of res.doc.disputeIds) expect(disputes.some((d) => d.id === id)).toBe(true);
    const table = formatDemoTable(res.rows);
    expect(table.split("\n")).toHaveLength(9);
    expect(table).toContain("chain verified");
  });

  it("adds nothing the second time", async () => {
    const rt = await freshRuntime();
    const slips = rt.store.slips.list().length;
    const runs = rt.orchestrator.list().length;
    const res = await loadDemoStory(rt);
    expect(res.status).toBe("already_loaded");
    expect(res.ok).toBe(true);
    expect(rt.store.slips.list().length).toBe(slips);
    expect(rt.orchestrator.list().length).toBe(runs);
  });

  it("puts the demo disputes back on a fresh mock rail after a restart", async () => {
    const rt = await freshRuntime();
    const doc = readDemoStory(rt.store)!;
    const ids = (await rt.rail.listDisputes()).map((d) => d.id);
    for (const id of doc.disputeIds) expect(ids).toContain(id);
    const answered = (await rt.rail.listDisputes()).find((d) => d.id === doc.disputeIds[0]);
    expect(answered?.status).toBe("UNDER_REVIEW");
  });

  it("POST handler: 200 in mock mode, 404 when PayPal is the sandbox", async () => {
    const rt = await freshRuntime();
    const ok = await demoSeedResponse(() => rt, MOCK_ENV);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ status: "already_loaded", ok: true });
    const sandbox = await demoSeedResponse(() => rt, { PAYPAL_MODE: "sandbox", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" });
    expect(sandbox.status).toBe(404);
  });

  it("refuses a runtime that is not fully mock", async () => {
    const rt = createTestRuntime({ seedRail: false });
    const notMockAi = { ...rt, ai: { ...rt.ai, mode: "anthropic" as const } };
    await expect(loadDemoStory(notMockAi)).rejects.toBeInstanceOf(DemoSeedError);
    const res = await demoSeedResponse(() => notMockAi, MOCK_ENV);
    expect(res.status).toBe(409);
  });
});

describe("demo affiliate account", () => {
  it("seeding twice leaves one account, and the story run used it", async () => {
    const rt = await freshRuntime();
    expect(affiliateRepo(rt.store).list()).toHaveLength(1);
    await loadDemoStory(rt);
    expect(seedDemoAffiliate(rt)).toBeNull();
    const [a] = affiliateRepo(rt.store).list();
    expect(a).toMatchObject({
      network: "generic",
      label: "Demo affiliate (sample shops)",
      trackingId: "permission-slip-demo",
      params: { ref: "{id}" },
      commissionBps: 400,
      active: true,
    });
    expect(a.domains).toEqual(["dinodepot.example", "toyburrow.example", "figurefarm.example", "pagepond.example"]);
  });

  it("adds nothing when the owner already has an account", () => {
    const rt = createTestRuntime({ seedRail: false });
    affiliateRepo(rt.store).create({ network: "amazon", trackingId: "leoshop-21" });
    expect(seedDemoAffiliate(rt)).toBeNull();
    expect(affiliateRepo(rt.store).list()).toHaveLength(1);
  });

  it("a sandbox runtime gets none", async () => {
    const rt = createTestRuntime({ seedRail: false });
    const sandbox = { ...rt, rail: Object.assign(Object.create(rt.rail) as typeof rt.rail, { mode: "sandbox" as const }), mockRail: null };
    expect(seedDemoAffiliate(sandbox)).toBeNull();
    await expect(loadDemoStory(sandbox)).rejects.toBeInstanceOf(DemoSeedError);
    expect(affiliateRepo(rt.store).list()).toEqual([]);
  });
});
