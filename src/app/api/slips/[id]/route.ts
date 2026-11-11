import { connection, type NextRequest } from "next/server";
import { jsonError } from "@/server/http";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";

/** GET /api/slips/[id] -> {slip, events, children, chain}. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/slips/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const { store } = getRuntime();
  const slip = store.slips.get(id);
  if (!slip) return jsonError(404, `slip ${id} not found`);
  return Response.json({
    slip,
    events: store.ledger.list(id),
    children: store.slips.list({ parentId: id }),
    chain: store.ledger.verifyChain(id),
  });
}
