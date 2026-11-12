import { describe, expect, it } from "vitest";
import { createMockRail } from "@/core/rail/mock";
import { createSqliteStore } from "@/core/store/sqlite";
import { demoStories, DEMO_STORY_KEY, restoreDemoDisputes, type DemoStoryDoc } from "./demo-restore";

const now = () => new Date("2026-11-08T12:00:00.000Z");

function saveStory(store: ReturnType<typeof createSqliteStore>, disputes: DemoStoryDoc["disputes"]) {
  demoStories(store).put(DEMO_STORY_KEY, {
    version: 1,
    status: "loaded",
    startedAt: now().toISOString(),
    finishedAt: now().toISOString(),
    error: null,
    runs: [],
    disputeIds: disputes.map((d) => d.id),
    disputes,
  });
}

describe("restoreDemoDisputes", () => {
  it("puts back missing disputes on a rail without them, once", async () => {
    const store = createSqliteStore(":memory:");
    const rail = createMockRail({ baseUrl: "http://x", now, seed: false });
    saveStory(store, [{ id: "PP-D-1", reason: "OTHER", status: "WAITING_FOR_SELLER_RESPONSE", amount: { currency: "USD", value: "5.00" }, createdAt: now().toISOString(), sellerResponseDueAt: now().toISOString(), transactionId: null, buyerEmail: "b@example.com", messages: ["hi"] }]);
    expect(restoreDemoDisputes(store, rail)).toBe(1);
    expect(restoreDemoDisputes(store, rail)).toBe(0);
    expect(await rail.listDisputes()).toHaveLength(1);
  });

  it("does not duplicate or roll back disputes that live in shared rail state", async () => {
    const store = createSqliteStore(":memory:");
    const first = createMockRail({ baseUrl: "http://x", now, store });
    const [d] = await first.listDisputes();
    saveStory(store, [d]);
    await first.acceptClaim(d.id, "done");
    const fresh = createMockRail({ baseUrl: "http://x", now, store });
    expect(restoreDemoDisputes(store, fresh)).toBe(0);
    const list = await fresh.listDisputes();
    expect(list).toHaveLength(2);
    expect(list.find((x) => x.id === d.id)?.status).toBe("RESOLVED");
  });
});
