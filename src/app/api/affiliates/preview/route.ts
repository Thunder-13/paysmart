import { affiliateLink, affiliateRepo } from "@/core/affiliate";
import { checkAffiliateAdmin } from "@/server/admin-auth";
import { jsonError, readJson } from "@/server/http";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/affiliates/preview {url} -> {url, link}. link is null when no active account matches. */
export async function POST(request: Request): Promise<Response> {
  const denied = checkAffiliateAdmin(request);
  if (denied) return denied;
  const body = await readJson(request);
  const url = typeof body === "object" && body !== null ? (body as { url?: unknown }).url : undefined;
  if (typeof url !== "string" || url.trim() === "") return jsonError(400, "Send {url: string}.");
  return Response.json({ url: url.trim(), link: affiliateLink(url.trim(), affiliateRepo(getRuntime().store).active()) });
}
