import { boardResponse } from "@/pipelines/dispute-desk/api";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/p/dispute-desk/disputes -> deadline board (lanes by status, urgency, links, cases). */
export async function GET(): Promise<Response> {
  return boardResponse(getRuntime());
}
