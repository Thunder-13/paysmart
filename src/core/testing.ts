/**
 * Test runtime: in-memory SQLite, mock rail, mock AI, the real guard/services/orchestrator, and the
 * registry's pipelines unless you pass your own.
 *
 *   const rt = createTestRuntime();
 *   const run = await rt.orchestrator.start("shop", input);
 *   rt.mockRail.approveOrder(orderId, "buyer@example.com");
 */
import type { MockRailControls, PipelineDefinition, PipelineId, Runtime } from "./contracts";
import { createMockAI } from "./ai/mock";
import { createMockRail, type MockRail } from "./rail/mock";
import { buildRuntime, type AppRuntime } from "./runtime-factory";
import { createSqliteStore, type SqliteStore } from "./store/sqlite";
import { pipelines as registryPipelines } from "@/pipelines/registry";

export const TEST_BASE_URL = "http://localhost:3000";

export type TestRuntime = AppRuntime & { mockRail: MockRailControls & MockRail; store: SqliteStore };

export function createTestRuntime(
  opts: {
    now?: () => Date;
    pipelines?: Record<PipelineId, PipelineDefinition> | Partial<Record<PipelineId, PipelineDefinition>>;
    /** Load the mock rail's default transactions/invoices/disputes (default true). */
    seedRail?: boolean;
  } = {},
): Runtime & TestRuntime {
  const nowRef = { fn: opts.now };
  const now = () => (nowRef.fn ? nowRef.fn() : new Date());
  const store = createSqliteStore(":memory:", { now });
  const mockRail = createMockRail({ baseUrl: TEST_BASE_URL, now, seed: opts.seedRail ?? true });
  const runtime = buildRuntime({
    store,
    rail: mockRail,
    ai: createMockAI(),
    pipelines: opts.pipelines ?? registryPipelines,
    baseUrl: TEST_BASE_URL,
    now,
  }) as TestRuntime;
  runtime.mockRail = mockRail;
  return runtime;
}

export { tamperEvent } from "./store/tamper";
