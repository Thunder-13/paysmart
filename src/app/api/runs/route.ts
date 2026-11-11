import { after, connection, type NextRequest } from "next/server";
import { PipelineIdSchema } from "@/core/contracts";
import { errorResponse, jsonError, readJson, settle } from "@/server/http";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";

/** GET /api/runs?pipeline=shop -> Run[] (newest first). */
export async function GET(request: NextRequest) {
  await connection();
  const raw = request.nextUrl.searchParams.get("pipeline");
  const pipeline = raw ? PipelineIdSchema.safeParse(raw) : null;
  if (pipeline && !pipeline.success) return jsonError(400, `Unknown pipeline: ${raw}`);
  return Response.json(getRuntime().orchestrator.list(pipeline ? { pipeline: pipeline.data } : {}));
}

/** POST /api/runs {pipeline, input} -> 202 Run snapshot; the run keeps going in the background. */
export async function POST(request: NextRequest) {
  const body = (await readJson(request)) as { pipeline?: unknown; input?: unknown } | undefined;
  const pipeline = PipelineIdSchema.safeParse(body?.pipeline);
  if (!pipeline.success) return jsonError(400, `Unknown pipeline: ${String(body?.pipeline)}`);
  try {
    const { run, done } = getRuntime().orchestrator.begin(pipeline.data, body?.input ?? {});
    after(() => settle(done));
    return Response.json(run, { status: 202 });
  } catch (e) {
    return errorResponse(e);
  }
}
