import { connection, type NextRequest } from "next/server";
import { errorResponse, jsonError } from "@/server/http";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";

/** GET /api/slips/[id]/evidence -> EvidencePack (add ?download=1 for a file). */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/slips/[id]/evidence">) {
  await connection();
  const { id } = await ctx.params;
  const rt = getRuntime();
  if (!rt.store.slips.get(id)) return jsonError(404, `slip ${id} not found`);
  try {
    const pack = await rt.core.evidencePack(id);
    const download = request.nextUrl.searchParams.get("download") === "1";
    return Response.json(pack, {
      headers: download ? { "Content-Disposition": `attachment; filename="evidence-${id}.json"` } : {},
    });
  } catch (e) {
    return errorResponse(e);
  }
}
