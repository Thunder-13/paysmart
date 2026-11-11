import { AffiliateInputError, AffiliateNotFoundError, affiliateRepo, type AffiliateAccountInput } from "@/core/affiliate";
import { checkAffiliateAdmin } from "@/server/admin-auth";
import { jsonError, readJson } from "@/server/http";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/affiliates/[id] -> {account}. 404 for an unknown id, 400 {error, issues} on bad input. */
export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const denied = checkAffiliateAdmin(request);
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = await readJson(request);
  if (typeof body !== "object" || body === null || Array.isArray(body)) return jsonError(400, "Send a JSON object.");
  try {
    return Response.json({ account: affiliateRepo(getRuntime().store).update(id, body as Partial<AffiliateAccountInput>) });
  } catch (e) {
    if (e instanceof AffiliateNotFoundError) return jsonError(404, e.message);
    if (e instanceof AffiliateInputError) return jsonError(400, e.message, { issues: e.issues });
    throw e;
  }
}

/** DELETE /api/affiliates/[id] -> {removed: true}. 404 for an unknown id. */
export async function DELETE(request: Request, ctx: Ctx): Promise<Response> {
  const denied = checkAffiliateAdmin(request);
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!affiliateRepo(getRuntime().store).remove(id)) return jsonError(404, `affiliate account ${id} not found`);
  return Response.json({ removed: true });
}
