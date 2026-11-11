import { after, type NextRequest } from "next/server";
import { errorResponse, readJson, settle } from "@/server/http";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";

/** POST /api/runs/[id]/resume {signal} -> 202 Run snapshot; 409 when the run is not waiting. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/runs/[id]/resume">) {
  const { id } = await ctx.params;
  const body = (await readJson(request)) as { signal?: unknown } | undefined;
  try {
    const { run, done } = getRuntime().orchestrator.beginResume(id, body?.signal);
    after(() => settle(done));
    return Response.json(run, { status: 202 });
  } catch (e) {
    return errorResponse(e);
  }
}
