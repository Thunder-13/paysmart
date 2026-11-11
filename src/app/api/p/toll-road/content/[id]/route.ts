import { handleGatewayGet } from "@/pipelines/toll-road/server";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The toll booth. Without `x-permission-slip` this answers 402 with a price quote and
 * `WWW-Authenticate: PermissionSlip realm="toll-road"`. With an active toll slip it meters the
 * fetch against the slip and returns the article.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handleGatewayGet(getRuntime(), id, request.headers);
}
