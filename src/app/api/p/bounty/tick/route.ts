import { bountyTickResponse } from "@/server/cron";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/p/bounty/tick with `Authorization: Bearer $CRON_SECRET` -> {resumed, closed}.
 * The deadline sweep from scripts/bounty-tick.ts, for schedulers that can only reach the web
 * service (the Render cron job in render.yaml). Off (404) until CRON_SECRET is set.
 */
export async function POST(request: Request): Promise<Response> {
  return bountyTickResponse(request, getRuntime);
}
