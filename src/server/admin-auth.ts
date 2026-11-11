/**
 * Bearer check for the owner-only affiliate admin surface.
 * AFFILIATE_ADMIN_SECRET empty -> 404 (the surface is off). Missing or wrong bearer -> 401.
 */
import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Constant-time compare that never throws on a length mismatch: both sides are hashed to 32 bytes first. */
function sameSecret(given: string, want: string): boolean {
  return timingSafeEqual(digest(given), digest(want));
}

/** Returns null when the request may proceed, otherwise the Response to send. */
export function checkAffiliateAdmin(request: Request, env: Record<string, string | undefined> = process.env): Response | null {
  const secret = env.AFFILIATE_ADMIN_SECRET?.trim();
  if (!secret) return Response.json({ error: "Not found" }, { status: 404 });
  const match = /^Bearer\s+(.+)$/i.exec((request.headers.get("authorization") ?? "").trim());
  if (!match || !sameSecret(match[1], secret)) {
    return Response.json(
      { error: "Send Authorization: Bearer <AFFILIATE_ADMIN_SECRET>." },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="affiliates"' } },
    );
  }
  return null;
}
