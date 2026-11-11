/**
 * Drives Second Look runs end to end on a runtime with the mock rail. Shared by the pipeline tests
 * and scripts/second-look-smoke.ts. Each helper throws with a clear message when the run is not
 * where the flow expects it.
 */
import type { MockRailControls, Orchestrator, Run } from "@/core/contracts";
import { FIXTURES, type FixtureId } from "./fixtures";
import type { SecondLookState } from "./types";

export type SLRun = Run<SecondLookState>;

export interface FlowRuntime {
  orchestrator: Orchestrator;
  mockRail: Pick<MockRailControls, "approveOrder">;
}

export const DEMO_BUYER = { name: "Alex Buyer", email: "alex.buyer@example.com" };
export const DEMO_FAMILY = "mom@example.com";
export const DEMO_TRACKING = { trackingNumber: "9400100000000000000000", carrier: "USPS" as const };

export function fixtureInput(id: FixtureId, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const f = FIXTURES[id];
  return {
    chatText: f.chatText,
    listingText: f.listingText,
    sellerEmail: f.sellerEmail,
    amount: f.amount,
    principal: DEMO_BUYER,
    trustedContactEmail: DEMO_FAMILY,
    ...overrides,
  };
}

function expectWait(run: Run, kind: string, event?: string): SLRun {
  const data = run.wait?.data as { event?: string } | undefined;
  if (run.status !== "waiting" || run.wait?.kind !== kind || (event && data?.event !== event)) {
    throw new Error(
      `Expected the run to wait on ${kind}${event ? `/${event}` : ""}, but it is ${run.status} at ${run.step}` +
        `${run.wait ? ` (${run.wait.kind})` : ""}${run.error ? `: ${run.error}` : ""}`,
    );
  }
  return run as SLRun;
}

export async function startToOffer(rt: FlowRuntime, input: Record<string, unknown>): Promise<SLRun> {
  return expectWait(await rt.orchestrator.start("second-look", input), "user_confirm");
}

export async function startToSeller(rt: FlowRuntime, input: Record<string, unknown>): Promise<SLRun> {
  const offer = await startToOffer(rt, input);
  return expectWait(await rt.orchestrator.resume(offer.id, { action: "send_offer" }), "external_event", "seller_response");
}

export async function startToApproval(rt: FlowRuntime, input: Record<string, unknown>): Promise<SLRun> {
  const seller = await startToSeller(rt, input);
  return expectWait(await rt.orchestrator.resume(seller.id, { response: "accepted" }), "paypal_approval");
}

/** Approves the order on the mock rail and resumes like /api/paypal/return does. */
export async function approveToShipment(rt: FlowRuntime, approval: SLRun): Promise<SLRun> {
  const orderId = approval.state.orderId;
  if (!orderId) throw new Error("The approval wait has no order id.");
  rt.mockRail.approveOrder(orderId, DEMO_BUYER.email);
  return expectWait(await rt.orchestrator.resume(approval.id, { approved: true, orderId }), "external_event", "shipment");
}

export async function protectedFlow(rt: FlowRuntime, input: Record<string, unknown>): Promise<SLRun> {
  const shipment = await approveToShipment(rt, await startToApproval(rt, input));
  return (await rt.orchestrator.resume(shipment.id, { event: "shipped", ...DEMO_TRACKING })) as SLRun;
}
