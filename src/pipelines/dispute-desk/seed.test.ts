import { describe, expect, it } from "vitest";
import { money } from "@/core/money";
import { loadBoard } from "./api";
import { REASON_NOT_AS_DESCRIBED, REASON_NOT_RECEIVED } from "./reasons";
import { demoDisputeId, ensureFixtureDisputes, FIXTURE_IDS, SEED_MOCK_ONLY, seedDemoDisputes } from "./seed";
import { deskRuntime, notReceivedHistory, TEST_NOW } from "./testkit";

describe("seedDemoDisputes", () => {
  it("seeds one dispute per link with the scenario reason and capture id", async () => {
    const rt = deskRuntime();
    const { captureId } = await notReceivedHistory(rt);
    const res = await seedDemoDisputes(rt, [
      { captureId, scenario: "not_received" },
      { captureId: "CAP-2", scenario: "not_as_described" },
    ]);
    expect(res.mode).toBe("mock");
    expect(res.created).toHaveLength(2);
    const list = await rt.rail.listDisputes();
    const a = list.find((d) => d.transactionId === captureId)!;
    const b = list.find((d) => d.transactionId === "CAP-2")!;
    expect(a).toMatchObject({ reason: REASON_NOT_RECEIVED, status: "WAITING_FOR_SELLER_RESPONSE", amount: money("48.00"), buyerEmail: "ada@example.com" });
    expect(a.sellerResponseDueAt).toBe(new Date(TEST_NOW.getTime() + 36 * 3_600_000).toISOString());
    expect(a.messages.some((m) => /ignore previous instructions/.test(m))).toBe(true);
    expect(b).toMatchObject({ reason: REASON_NOT_AS_DESCRIBED, amount: money("35.00") });
    expect(a.id).toBe(demoDisputeId({ captureId, scenario: "not_received" }));
  });

  it("seeding twice creates nothing new", async () => {
    const rt = deskRuntime();
    const links = [{ captureId: "CAP-9", scenario: "unlinked" as const }];
    await seedDemoDisputes(rt, links);
    const again = await seedDemoDisputes(rt, links);
    expect(again.created).toEqual([]);
    expect(again.skipped).toHaveLength(1);
    expect(await rt.rail.listDisputes()).toHaveLength(1);
  });

  it("fixtures appear once after two board loads", async () => {
    const rt = deskRuntime();
    await loadBoard(rt);
    const board = await loadBoard(rt);
    const ids = board.lanes.flatMap((l) => l.cards.map((c) => c.disputeId));
    for (const id of FIXTURE_IDS) expect(ids.filter((x) => x === id)).toHaveLength(1);
    expect(board.lanes.filter((l) => l.cards.length > 0).length).toBeGreaterThanOrEqual(2);
    expect(await ensureFixtureDisputes(rt)).toEqual([]);
  });

  it("sandbox-mode rail creates nothing and says seeding is mock-only", async () => {
    const rt = deskRuntime();
    const sandboxRail = Object.assign(Object.create(rt.rail) as typeof rt.rail, { mode: "sandbox" as const });
    const fake = { rail: sandboxRail, store: rt.store, now: rt.now, mockRail: null };
    const res = await seedDemoDisputes(fake, [{ captureId: "CAP-1", scenario: "not_received" }]);
    expect(res).toMatchObject({ mode: "sandbox", created: [], message: SEED_MOCK_ONLY });
    expect(await ensureFixtureDisputes(fake)).toEqual([]);
    expect(await rt.rail.listDisputes()).toEqual([]);
  });
});
