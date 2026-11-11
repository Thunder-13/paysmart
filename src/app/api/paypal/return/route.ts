import { after, connection, NextResponse, type NextRequest } from "next/server";
import { returnPathOf, runForSlip, settle, withRunParam } from "@/server/http";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";

/**
 * PayPal sends the buyer here after approval: /api/paypal/return?slipId=...&token=<orderId>.
 * Resumes the slip's waiting run with {approved: true, orderId} in the background and redirects
 * to slip.meta.returnPath with run=<runId> appended.
 */
export async function GET(request: NextRequest) {
  await connection();
  const sp = request.nextUrl.searchParams;
  const slipId = sp.get("slipId") ?? "";
  const rt = getRuntime();
  const slip = slipId ? rt.store.slips.get(slipId) : null;
  const orderId = sp.get("token") ?? slip?.rail.orderId ?? null;
  const { waiting, latest } = runForSlip(rt.orchestrator.list(), slipId);
  let runId = latest?.id ?? null;
  // A run waiting on anything but PayPal approval (for example the cart) is not ours to resume: a stale link just lands on the run's state.
  if (waiting && waiting.wait?.kind === "paypal_approval") {
    try {
      const { run, done } = rt.orchestrator.beginResume(waiting.id, { approved: true, orderId });
      runId = run.id;
      after(() => settle(done));
    } catch {
      runId = waiting.id; // already resumed by a double click; the page shows its state
    }
  }
  return NextResponse.redirect(new URL(withRunParam(returnPathOf(slip), runId), request.url), 303);
}
