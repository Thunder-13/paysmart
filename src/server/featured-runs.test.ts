import { describe, expect, it } from "vitest";
import type { PipelineId, Run } from "@/core/contracts";
import { createSqliteStore } from "@/core/store/sqlite";
import { demoStories, DEMO_STORY_KEY, type DemoStoryDoc } from "./demo-restore";
import { featuredRuns } from "./featured-runs";

function run(id: string, pipeline: PipelineId, createdAt: string, state: Record<string, unknown> = {}): Run {
  return { id, pipeline, slipId: null, status: "done", step: "done", state, wait: null, error: null, createdAt, updatedAt: createdAt };
}

function setup(runs: Run[]) {
  const store = createSqliteStore(":memory:");
  const orchestrator = { get: (id: string) => runs.find((r) => r.id === id) ?? null, list: () => runs };
  return { store, orchestrator };
}

function story(runs: DemoStoryDoc["runs"], status: DemoStoryDoc["status"] = "loaded"): DemoStoryDoc {
  return { version: 1, status, startedAt: "2026-11-09T10:00:00.000Z", finishedAt: "2026-11-09T10:00:05.000Z", error: null, runs, disputeIds: [], disputes: [] };
}

describe("featured runs for the home cards", () => {
  it("is empty before any run", () => {
    const f = featuredRuns(setup([]));
    expect(Object.values(f).every((v) => v === null)).toBe(true);
  });

  it("uses the most recent run, never a bounty pledge", () => {
    const rt = setup([
      run("shop_old", "shop", "2026-11-09T09:00:00.000Z"),
      run("shop_new", "shop", "2026-11-09T11:00:00.000Z"),
      run("bounty_board", "bounty", "2026-11-09T09:00:00.000Z", { kind: "bounty" }),
      run("bounty_pledge", "bounty", "2026-11-09T09:30:00.000Z", { kind: "pledge" }),
    ]);
    const f = featuredRuns(rt);
    expect(f.shop).toEqual({ runId: "shop_new", status: "done", label: null });
    expect(f.bounty?.runId).toBe("bounty_board");
    expect(f["toll-road"]).toBeNull();
  });

  it("prefers the loaded demo story's main run over newer runs", () => {
    const rt = setup([run("demo_shop", "shop", "2026-11-09T10:00:00.000Z"), run("later_shop", "shop", "2026-11-09T12:00:00.000Z")]);
    demoStories(rt.store).put(
      DEMO_STORY_KEY,
      story([
        { pipeline: "shop", runId: "demo_shop", role: "main", label: "Red-team listing, refund" },
        { pipeline: "second-look", runId: "gone", role: "main", label: "Missing run" },
      ]),
    );
    const f = featuredRuns(rt);
    expect(f.shop).toEqual({ runId: "demo_shop", status: "done", label: "Red-team listing, refund" });
    expect(f["second-look"]).toBeNull();
  });

  it("ignores a story that did not finish loading", () => {
    const rt = setup([run("demo_shop", "shop", "2026-11-09T10:00:00.000Z"), run("later_shop", "shop", "2026-11-09T12:00:00.000Z")]);
    demoStories(rt.store).put(DEMO_STORY_KEY, story([{ pipeline: "shop", runId: "demo_shop", role: "main", label: "x" }], "failed"));
    expect(featuredRuns(rt).shop?.runId).toBe("later_shop");
  });
});
