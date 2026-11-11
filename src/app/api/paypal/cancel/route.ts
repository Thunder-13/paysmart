import { after, connection, NextResponse, type NextRequest } from "next/server";
import { appendEvent } from "@/core/events";
import { returnPathOf, runForSlip, settle, withRunParam } from "@/server/http";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";

/**
 * The buyer backed out of PayPal: mark the slip "rejected", resume its waiting run with
 * {approved: false, orderId}, and redirect to slip.meta.returnPath with run=<runId>.
 */
export async function GET(request: NextRequest) {
  await connection();
  const sp = request.nextUrl.searchParams;
  const slipId = sp.get("slipId") ?? "";
  const rt = getRuntime();
  const slip = slipId ? rt.store.slips.get(slipId) : null;
  const orderId = sp.get("token") ?? slip?.rail.orderId ?? null;
  if (slip && (slip.status === "awaiting_signature" || slip.status === "draft")) {
    rt.store.slips.update(slip.id, { status: "rejected" });
    appendEvent(rt.store.ledger, slip.id, "slip.status", "user", {
      from: slip.status,
      to: "rejected",
      reason: "The buyer cancelled on PayPal.",
    });
  }
  const { waiting, latest } = runForSlip(rt.orchestrator.list(), slipId);
  let runId = latest?.id ?? null;
  // A run waiting on anything but PayPal approval (for example the cart) is not ours to resume: a stale link just lands on the run's state.
  if (waiting && waiting.wait?.kind === "paypal_approval") {
    try {
      const { run, done } = rt.orchestrator.beginResume(waiting.id, { approved: false, orderId });
      runId = run.id;
      after(() => settle(done));
    } catch {
      runId = waiting.id;
    }
  }
  return NextResponse.redirect(new URL(withRunParam(returnPathOf(slip), runId), request.url), 303);
}
