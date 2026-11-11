import { seedResponse } from "@/pipelines/dispute-desk/api";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/p/dispute-desk/seed {links: [{captureId, scenario}]} -> SeedResult (mock mode only; 409 in sandbox). */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = undefined;
  }
  return seedResponse(getRuntime(), body);
}
