import { connection, type NextRequest } from "next/server";
import { listAlerts } from "@/pipelines/second-look/family";
import { jsonError } from "@/server/http";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/p/second-look/alerts?to=<email> -> FamilyAlert[] for that trusted contact, newest first. */
export async function GET(request: NextRequest) {
  await connection();
  const to = request.nextUrl.searchParams.get("to")?.trim() ?? "";
  if (!to) return jsonError(400, "Add ?to=<trusted contact email>.");
  return Response.json(listAlerts(getRuntime().store, to));
}
