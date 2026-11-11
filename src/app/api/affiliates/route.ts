import { AffiliateInputError, NETWORK_PRESETS, affiliateRepo, type AffiliateAccountInput } from "@/core/affiliate";
import { checkAffiliateAdmin } from "@/server/admin-auth";
import { jsonError, readJson } from "@/server/http";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/affiliates -> {accounts, presets}. Owner only: Authorization: Bearer $AFFILIATE_ADMIN_SECRET. */
export async function GET(request: Request): Promise<Response> {
  const denied = checkAffiliateAdmin(request);
  if (denied) return denied;
  return Response.json({ accounts: affiliateRepo(getRuntime().store).list(), presets: NETWORK_PRESETS });
}

/** POST /api/affiliates -> 201 {account}. 400 {error, issues} on bad input. */
export async function POST(request: Request): Promise<Response> {
  const denied = checkAffiliateAdmin(request);
  if (denied) return denied;
  const body = await readJson(request);
  if (typeof body !== "object" || body === null || Array.isArray(body)) return jsonError(400, "Send a JSON object.");
  try {
    const account = affiliateRepo(getRuntime().store).create(body as AffiliateAccountInput);
    return Response.json({ account }, { status: 201 });
  } catch (e) {
    if (e instanceof AffiliateInputError) return jsonError(400, e.message, { issues: e.issues });
    throw e;
  }
}
