/** Test helpers for the shop pipeline (imported by *.test.ts only). */
import { affiliateRepo } from "@/core/affiliate";
import type { LedgerEvent, Run, StepContext, Verdict } from "@/core/contracts";
import type { GuardVerdictData } from "@/core/events";
import { normalizeCompiledSlip } from "@/core/services";
import { createTestRuntime } from "@/core/testing";
import { mockCompile } from "./compile";
import { createShopPipeline } from "./index";
import { initialShopState, type ShopOptions } from "./steps";
import { DEMO_INTENT, ShopInputSchema, type ShopState } from "./types";

/** Sunday 2026-11-08 18:00 UTC: next Saturday is 2026-11-14. */
export const NOW = "2026-11-08T18:00:00.000Z";
export const HELPER_EMAIL = "card-writer@helpers.example";

export function shopRuntime(opts: { now?: string | (() => Date); shop?: ShopOptions } = {}) {
  const iso = typeof opts.now === "string" ? opts.now : NOW;
  const clock = typeof opts.now === "function" ? opts.now : () => new Date(iso);
  return createTestRuntime({
    now: clock,
    seedRail: false,
    pipelines: {
      shop: createShopPipeline({ channel3ApiKey: () => null, helperEmail: () => HELPER_EMAIL, ...opts.shop }),
    },
  });
}

export type ShopRuntime = ReturnType<typeof shopRuntime>;

export function waitData(run: Run): Record<string, unknown> {
  const d = run.wait?.data;
  return d && typeof d === "object" ? (d as Record<string, unknown>) : {};
}

export function state(run: Run): ShopState {
  return run.state as unknown as ShopState;
}

/** Start, approve the slip, sign at the mock PayPal, and stop at the cart confirmation. */
export async function runToCart(rt: ShopRuntime, input: Record<string, unknown> = {}, slipSignal: unknown = { approved: true }): Promise<Run> {
  let run = await rt.orchestrator.start("shop", input);
  if (run.step !== "confirm_slip") throw new Error(`expected confirm_slip, got ${run.status} ${run.step} ${run.error ?? ""}`);
  run = await rt.orchestrator.resume(run.id, slipSignal);
  if (run.step !== "complete_signing") throw new Error(`expected complete_signing, got ${run.status} ${run.step} ${run.error ?? ""}`);
  const orderId = String(waitData(run).orderId);
  rt.mockRail.approveOrder(orderId, "buyer@example.com");
  return rt.orchestrator.resume(run.id, { approved: true, orderId });
}

export function events(rt: ShopRuntime, slipId: string | null, type?: string): LedgerEvent[] {
  if (!slipId) return [];
  const all = rt.store.ledger.list(slipId);
  return type ? all.filter((e) => e.type === type) : all;
}

export function verdicts(rt: ShopRuntime, slipId: string | null): Verdict[] {
  return events(rt, slipId, "guard.verdict").map((e) => (e.data as GuardVerdictData).verdict);
}

export function cited(v: Verdict): string[] {
  return v.violations.map((x) => x.clauseId);
}

/** A signed $60 demo slip plus a StepContext for driving tools directly. */
export async function signedSession(rt: ShopRuntime, intent = DEMO_INTENT) {
  const now = rt.now();
  const compiled = normalizeCompiledSlip(mockCompile(intent, now), now);
  const created = rt.core.createSlip({
    pipeline: "shop",
    principal: { name: "Ada", email: null },
    intent,
    clauses: compiled.clauses,
    budget: compiled.budget,
    expiresAt: compiled.expiresAt,
    meta: { summary: compiled.summary },
  });
  const { orderId } = await rt.core.beginSigning(created.id, { intent: "AUTHORIZE", returnPath: "/p/shop" });
  rt.mockRail.approveOrder(orderId, "buyer@example.com");
  const slip = await rt.core.completeSigning(created.id);
  const run = {
    id: "run_test",
    pipeline: "shop",
    slipId: slip.id,
    status: "running",
    step: "shop",
    state: initialShopState(ShopInputSchema.parse({ intent })),
    wait: null,
    error: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  } as Run<ShopState>;
  const ctx: StepContext<ShopState> = {
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
  return { slip, ctx };
}

export const DEMO_AFFILIATE_ID = "permission-slip-demo";

/** The owner's demo affiliate account for the four sample shops (generic, ref={id}, 4%). */
export function addDemoAffiliate(rt: ShopRuntime) {
  return affiliateRepo(rt.store).create({
    network: "generic",
    label: "Demo affiliate (sample shops)",
    trackingId: DEMO_AFFILIATE_ID,
    domains: ["dinodepot.example", "toyburrow.example", "figurefarm.example", "pagepond.example"],
    params: { ref: "{id}" },
    commissionBps: 400,
  });
}
