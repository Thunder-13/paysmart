import { buildBoard } from "@/pipelines/bounty/board";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/p/bounty -> the board: every bounty with its pool slip, pledge slips, funding and run state. */
export async function GET() {
  return Response.json(buildBoard(getRuntime()));
}
