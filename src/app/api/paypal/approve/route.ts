import { after, connection, type NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, readJson, returnPathOf, runForSlip, settle } from "@/server/http";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";

const BodySchema = z.object({ orderId: z.string().min(1).max(64) });

/**
 * The v6 button's onApprove posts { orderId } here. Finds the slip that owns the order and resumes
 * its waiting run with {approved: true, orderId}, the same signal /api/paypal/return sends.
 * The order's own PayPal approval is what lets authorizeOrder succeed, so a forged call can't make a hold.
 */
export async function POST(request: NextRequest) {
  await connection();
  const parsed = BodySchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError(400, "orderId is required (1 to 64 characters)");
  const { orderId } = parsed.data;
  const rt = getRuntime();
  const slip = rt.store.slips.findByRailId(orderId);
  if (!slip) return jsonError(404, "No slip owns that order");
  const { waiting, latest } = runForSlip(rt.orchestrator.list(), slip.id);
  const returnPath = returnPathOf(slip);
  // A run waiting on anything but PayPal approval (for example the cart, after a first approval) is not ours to resume.
  if (!waiting || waiting.wait?.kind !== "paypal_approval") {
    return jsonError(409, "No run is waiting for this approval", { runId: latest?.id ?? null, returnPath });
  }
  try {
    const { run, done } = rt.orchestrator.beginResume(waiting.id, { approved: true, orderId });
    after(() => settle(done));
    return Response.json({ runId: run.id, returnPath });
  } catch {
    return jsonError(409, "The run was already resumed", { runId: waiting.id, returnPath });
  }
}
