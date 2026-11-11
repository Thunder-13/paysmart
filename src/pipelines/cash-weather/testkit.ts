/** Test helpers for Cash Weather: a fixed clock, parsed input, and direct step execution. */
import type { Run, StepContext, StepResult } from "@/core/contracts";
import { createTestRuntime } from "@/core/testing";
import { CashWeatherInputSchema, type CashWeatherInput, type CashWeatherState } from "./types";
import { DEFAULT_IMPORT_COUNTS, DEFAULT_PACKAGE_JSON } from "./fixtures";
import definition, { initialState } from "./index";

export const AS_OF = "2026-11-09";
export const NOW = new Date(`${AS_OF}T16:00:00.000Z`);

export type TestRt = ReturnType<typeof createTestRuntime>;

export function fixedRuntime(opts: { seedRail?: boolean } = {}): { rt: TestRt; clock: { now: Date } } {
  const clock = { now: NOW };
  const rt = createTestRuntime({ now: () => clock.now, seedRail: opts.seedRail });
  return { rt, clock };
}

export function testInput(overrides: Partial<Record<keyof CashWeatherInput, unknown>> = {}): CashWeatherInput {
  return CashWeatherInputSchema.parse({ packageJson: DEFAULT_PACKAGE_JSON, importCounts: DEFAULT_IMPORT_COUNTS, ...overrides });
}

export function ctxFor(rt: TestRt, state: CashWeatherState, signal?: unknown, slipId: string | null = state.slipId): StepContext<CashWeatherState> {
  const run: Run<CashWeatherState> = {
    id: "run_test",
    pipeline: "cash-weather",
    slipId,
    status: "running",
    step: "test",
    state,
    wait: null,
    error: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
  return {
    run,
    signal,
    rail: rt.rail,
    ai: rt.ai,
    extractor: rt.extractor,
    guard: rt.guard,
    store: rt.store,
    core: rt.core,
    baseUrl: rt.baseUrl,
    now: () => rt.now(),
    log: () => undefined,
  };
}

/** Runs the named steps in order, merging state like the orchestrator does. Returns the last result. */
export async function runSteps(
  rt: TestRt,
  state: CashWeatherState,
  names: string[],
  signal?: unknown,
): Promise<{ state: CashWeatherState; result: StepResult<CashWeatherState> }> {
  let current = state;
  let result: StepResult<CashWeatherState> = { next: names[0] };
  for (const [i, name] of names.entries()) {
    const step = definition.steps[name];
    if (!step) throw new Error(`no step ${name}`);
    result = await step(ctxFor(rt, current, i === 0 ? signal : undefined));
    if ("fail" in result) return { state: current, result };
    current = { ...current, ...(result.state ?? {}) };
  }
  return { state: current, result };
}

export const PLAN_STEPS = ["seed", "ingest", "forecast", "narrate", "upstream", "budget"];

/** Fresh state after seed..budget (and draft_slip when withSlip). */
export async function planned(rt: TestRt, input = testInput(), withSlip = true): Promise<CashWeatherState> {
  const names = withSlip ? [...PLAN_STEPS, "draft_slip"] : PLAN_STEPS;
  const { state, result } = await runSteps(rt, initialState(input), names);
  if ("fail" in result) throw new Error(result.fail);
  return state;
}
