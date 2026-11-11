import { connection, type NextRequest } from "next/server";
import { jsonError } from "@/server/http";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";

/** GET /api/runs/[id] -> {run, slip, events}; events are the run slip's chain only. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/runs/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const rt = getRuntime();
  const run = rt.orchestrator.get(id);
  if (!run) return jsonError(404, `run ${id} not found`);
  const slip = run.slipId ? rt.store.slips.get(run.slipId) : null;
  const events = run.slipId ? rt.store.ledger.list(run.slipId) : [];
  return Response.json({ run, slip, events });
}
