import { connection, type NextRequest } from "next/server";
import { PipelineIdSchema } from "@/core/contracts";
import { jsonError } from "@/server/http";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";

/** GET /api/slips?pipeline=shop -> Slip[] (newest first). */
export async function GET(request: NextRequest) {
  await connection();
  const raw = request.nextUrl.searchParams.get("pipeline");
  const pipeline = raw ? PipelineIdSchema.safeParse(raw) : null;
  if (pipeline && !pipeline.success) return jsonError(400, `Unknown pipeline: ${raw}`);
  return Response.json(getRuntime().store.slips.list(pipeline ? { pipeline: pipeline.data } : {}));
}
