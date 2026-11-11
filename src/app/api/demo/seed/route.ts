import { demoSeedResponse } from "@/server/demo-seed";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/demo/seed -> {status: "loaded" | "already_loaded", ok, message, rows, disputeIds}.
 * Runs the seven-pipeline demo story once (mock mode only; 404 otherwise). A second call adds nothing.
 */
export async function POST(): Promise<Response> {
  return demoSeedResponse(getRuntime);
}
