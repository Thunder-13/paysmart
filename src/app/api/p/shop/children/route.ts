import { connection, type NextRequest } from "next/server";
import { listChildren } from "@/pipelines/shop/api";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/p/shop/children?slipId=... -> helper slips carved from a shop slip (oldest first). */
export async function GET(request: NextRequest) {
  await connection();
  const slipId = request.nextUrl.searchParams.get("slipId") ?? "";
  if (!slipId) return Response.json({ error: "slipId is required" }, { status: 400 });
  return Response.json(listChildren(getRuntime(), slipId));
}
