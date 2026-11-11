import { connection, type NextRequest } from "next/server";
import type { Run } from "@/core/contracts";
import { HandoffError, getHandoff, recordHandoff } from "@/pipelines/second-look/handoff";
import type { SecondLookState } from "@/pipelines/second-look/types";
import { errorResponse, jsonError, readJson } from "@/server/http";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function secondLookRun(runId: string): Run<SecondLookState> | null {
  const run = getRuntime().orchestrator.get(runId);
  return run && run.pipeline === "second-look" ? (run as Run<SecondLookState>) : null;
}

/** GET /api/p/second-look/handoff?runId=<id> -> the hand-off record for that run, or 404. */
export async function GET(request: NextRequest) {
  await connection();
  const runId = request.nextUrl.searchParams.get("runId")?.trim() ?? "";
  if (!runId) return jsonError(400, "Add ?runId=<run id>.");
  const record = getHandoff(getRuntime().store, runId);
  return record ? Response.json(record) : jsonError(404, `No hand-off for run ${runId}.`);
}

/**
 * POST /api/p/second-look/handoff {runId} -> "item never arrived" for a run with a captured payment.
 * Idempotent per capture (201 first time, 200 after). 409 when the run has no capture.
 */
export async function POST(request: NextRequest) {
  const body = (await readJson(request)) as { runId?: unknown } | undefined;
  const runId = typeof body?.runId === "string" ? body.runId.trim() : "";
  if (!runId) return jsonError(400, "Send {runId}.");
  const run = secondLookRun(runId);
  if (!run) return jsonError(404, `Second Look run ${runId} not found.`);
  const rt = getRuntime();
  try {
    const existed = getHandoff(rt.store, run.id);
    const record = recordHandoff(rt.store, run, rt.now());
    return Response.json(record, { status: existed ? 200 : 201 });
  } catch (e) {
    if (e instanceof HandoffError) return jsonError(409, e.message);
    return errorResponse(e);
  }
}
