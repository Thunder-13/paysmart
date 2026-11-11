/**
 * Scheduled work over HTTP. Render disks attach to one service, so a separate cron service can't
 * open the SQLite file; it calls the web service instead (see render.yaml).
 *
 *   POST /api/p/bounty/tick   Authorization: Bearer $CRON_SECRET
 *
 * 404 while CRON_SECRET is unset (the route is off), 401 on a wrong or missing token.
 */
import { timingSafeEqual } from "node:crypto";
import type { Orchestrator } from "@/core/contracts";
import { tickAll } from "@/pipelines/bounty/tick";

export function cronAuthorized(request: Request, secret: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return false;
  const given = Buffer.from(match[1]);
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}

export async function bountyTickResponse(
  request: Request,
  getRt: () => { orchestrator: Orchestrator },
  env: Record<string, string | undefined> = process.env,
): Promise<Response> {
  const secret = env.CRON_SECRET?.trim();
  if (!secret) return Response.json({ error: "Not found" }, { status: 404 });
  if (!cronAuthorized(request, secret)) {
    return Response.json({ error: "Send Authorization: Bearer <CRON_SECRET>." }, { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="cron"' } });
  }
  const { resumed, closed } = await tickAll(getRt());
  return Response.json({ resumed, closed, at: new Date().toISOString() });
}
