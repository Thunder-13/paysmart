/** Shared setup for the Toll Road tests. Not shipped to the app (only *.test.ts files import it). */
import type { Run, Slip } from "@/core/contracts";
import { money } from "@/core/money";
import { createTestRuntime } from "@/core/testing";
import { ensureCatalog } from "./catalog";
import type { GatewayDeps } from "./gateway";
import type { TollState } from "./types";

export type TestRt = ReturnType<typeof createTestRuntime>;

export const BUYER = "buyer@example.com";

/** A runtime whose clock you can move: clock.advance(ms). */
export function clockedRuntime(start = "2026-11-10T15:00:00.000Z") {
  const clock = {
    t: Date.parse(start),
    advance(ms: number) {
      clock.t += ms;
    },
  };
  const rt = createTestRuntime({ now: () => new Date(clock.t) });
  ensureCatalog(rt.store);
  return { rt, clock };
}

export function gatewayDeps(rt: TestRt): GatewayDeps {
  return { store: rt.store, guard: rt.guard, now: () => rt.now(), baseUrl: rt.baseUrl };
}

/** A draft toll slip with budget_max, rate_card (fetch) and expires_at clauses. */
export function draftTollSlip(rt: TestRt, opts: { budget?: string; cap?: string; minutes?: number } = {}): Slip {
  const budget = money(opts.budget ?? "0.15");
  const cap = money(opts.cap ?? "0.05");
  const at = new Date(rt.now().getTime() + (opts.minutes ?? 60) * 60_000).toISOString();
  return rt.core.createSlip({
    pipeline: "toll-road",
    principal: { name: "Test operator", email: null },
    intent: "test toll slip",
    clauses: [
      { id: "c1", kind: "budget_max", label: "budget", amount: budget },
      { id: "c2", kind: "rate_card", unit: "fetch", label: "cap", price: cap },
      { id: "c3", kind: "expires_at", label: "ends", at },
    ],
    budget,
    expiresAt: at,
    meta: { role: "toll" },
  });
}

/** The same slip, signed through the mock rail and active. */
export async function activeTollSlip(rt: TestRt, opts: { budget?: string; cap?: string; minutes?: number } = {}): Promise<Slip> {
  const slip = draftTollSlip(rt, opts);
  const { orderId } = await rt.core.beginSigning(slip.id, { intent: "AUTHORIZE", returnPath: "/p/toll-road" });
  rt.mockRail.approveOrder(orderId, BUYER);
  return rt.core.completeSigning(slip.id);
}

export function stateOf(run: Run): TollState {
  return run.state as unknown as TollState;
}

/** Start a run and drive it through confirm and PayPal approval. Returns the final run. */
export async function runThrough(rt: TestRt, input: Record<string, unknown> = {}): Promise<Run> {
  const started = await rt.orchestrator.start("toll-road", input);
  const waitingPayPal = await rt.orchestrator.resume(started.id, { approved: true });
  const orderId = stateOf(waitingPayPal).orderId;
  if (!orderId) throw new Error(`run did not reach paypal_approval: ${waitingPayPal.status} ${waitingPayPal.error ?? ""}`);
  rt.mockRail.approveOrder(orderId, BUYER);
  return rt.orchestrator.resume(started.id, { approved: true, orderId });
}

export function railCalls(rt: TestRt, method?: string) {
  const calls = rt.mockRail.calls() as { method: string; args: unknown[] }[];
  return method ? calls.filter((c) => c.method === method) : calls;
}
