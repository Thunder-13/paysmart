/**
 * Wires a Runtime from its parts. Shared by src/server/runtime.ts (env-driven) and
 * src/core/testing.ts (in-memory). Does not import the pipeline registry itself.
 */
import type { AI, PayPalRail, PipelineDefinition, PipelineId, Runtime, Store } from "./contracts";
import { createExtractor } from "./extractor";
import { guard } from "./guard";
import { createOrchestrator, type AppOrchestrator } from "./orchestrator";
import { createCoreServices } from "./services";

export interface AppRuntime extends Runtime {
  orchestrator: AppOrchestrator;
}

export function buildRuntime(parts: {
  store: Store;
  rail: PayPalRail;
  ai: AI;
  pipelines: Partial<Record<PipelineId, PipelineDefinition>>;
  baseUrl: string;
  /** Defaults to () => new Date(), read at call time so vi.setSystemTime works. */
  now?: () => Date;
}): AppRuntime {
  const runtime = {
    rail: parts.rail,
    ai: parts.ai,
    guard,
    store: parts.store,
    baseUrl: parts.baseUrl.replace(/\/+$/, ""),
    now: parts.now ?? (() => new Date()),
  } as AppRuntime;
  runtime.extractor = createExtractor(parts.ai);
  // Services and the orchestrator read rail/now through the runtime object at call time.
  runtime.core = createCoreServices({
    get store() {
      return runtime.store;
    },
    get rail() {
      return runtime.rail;
    },
    get ai() {
      return runtime.ai;
    },
    get guard() {
      return runtime.guard;
    },
    baseUrl: runtime.baseUrl,
    now: () => runtime.now(),
  });
  runtime.orchestrator = createOrchestrator({
    pipelines: parts.pipelines,
    deps: {
      get rail() {
        return runtime.rail;
      },
      get ai() {
        return runtime.ai;
      },
      get extractor() {
        return runtime.extractor;
      },
      get guard() {
        return runtime.guard;
      },
      get store() {
        return runtime.store;
      },
      get core() {
        return runtime.core;
      },
      baseUrl: runtime.baseUrl,
      now: () => runtime.now(),
    },
  });
  return runtime;
}
