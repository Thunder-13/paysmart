/** Test helpers for the paysmart pipeline (imported by *.test.ts only). */
import type { LedgerEvent, Run, StepContext } from "@/core/contracts";
import { createTestRuntime } from "@/core/testing";
import { createPaySmartPipeline } from "./index";
import { initialPaySmartState, type PaySmartOptions } from "./steps";
import { PaySmartInputSchema, type PaySmartState } from "./types";

/** Sunday 2026-11-08 18:00 UTC: next Saturday is 2026-11-14. */
export const NOW = "2026-11-08T18:00:00.000Z";

export function paysmartRuntime(opts: { paysmart?: PaySmartOptions; now?: () => Date } = {}) {
  return createTestRuntime({
    now: opts.now ?? (() => new Date(NOW)),
    seedRail: false,
    pipelines: { paysmart: createPaySmartPipeline({ channel3ApiKey: () => null, ...opts.paysmart }) },
  });
}
export type PaySmartRuntime = ReturnType<typeof paysmartRuntime>;

export function waitData(run: Run): Record<string, unknown> {
  const d = run.wait?.data;
  return d && typeof d === "object" ? (d as Record<string, unknown>) : {};
}

export function state(run: Run): PaySmartState {
  return run.state as unknown as PaySmartState;
}

export function events(rt: PaySmartRuntime, slipId: string | null, type?: string): LedgerEvent[] {
  if (!slipId) return [];
  const all = rt.store.ledger.list(slipId);
  return type ? all.filter((e) => e.type === type) : all;
}

export function railCalls(rt: PaySmartRuntime, method?: string) {
  const all = rt.mockRail.calls();
  return method ? all.filter((c) => c.method === method) : all;
}

/** Start and run until the choose wait (no money moves before it). */
export async function runToChoose(rt: PaySmartRuntime, input: Record<string, unknown> = {}): Promise<Run> {
  const run = await rt.orchestrator.start("paysmart", input);
  if (run.step !== "choose") throw new Error(`expected choose, got ${run.status} ${run.step} ${run.error ?? ""}`);
  return run;
}

/** Choose an option, sign at the mock PayPal, and stop at the delivery wait. */
export async function runToDelivery(rt: PaySmartRuntime, input: Record<string, unknown> = {}, choose: Record<string, unknown> = { approved: true }): Promise<Run> {
  let run = await runToChoose(rt, input);
  run = await rt.orchestrator.resume(run.id, choose);
  if (run.step !== "complete_signing") throw new Error(`expected complete_signing, got ${run.status} ${run.step} ${run.error ?? ""}`);
  const orderId = String(waitData(run).orderId);
  rt.mockRail.approveOrder(orderId, "buyer@example.com");
  return rt.orchestrator.resume(run.id, { approved: true, orderId });
}

/** A slip-less StepContext for driving a step function directly. */
export function stepContext(rt: PaySmartRuntime, overrides: Partial<PaySmartState> = {}, slipId: string | null = null): StepContext<PaySmartState> {
  const now = rt.now();
  const base = initialPaySmartState(PaySmartInputSchema.parse({}));
  const run = {
    id: "run_test",
    pipeline: "paysmart",
    slipId,
    status: "running",
    step: "discover",
    state: { ...base, ...overrides },
    wait: null,
    error: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  } as Run<PaySmartState>;
  return {
    run,
    signal: undefined,
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
