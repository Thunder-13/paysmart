import type { Metadata } from "next";
import { PipelineHeader } from "@/components/pipeline-header";
import definition from "@/pipelines/dispute-desk";
import { loadBoard } from "@/pipelines/dispute-desk/api";
import { emptyBoard, type Board } from "@/pipelines/dispute-desk/board";
import { getRuntime } from "@/server/runtime";
import { DisputeDesk } from "./dispute-desk-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Dispute Desk", description: definition.tagline };

/** ?run=<id> of a Dispute Desk run: open on that run's dispute. Anything else is ignored. */
function runFromUrl(rt: ReturnType<typeof getRuntime>, value: string | string[] | undefined): { runId: string; disputeId: string } | null {
  const runId = typeof value === "string" ? value.trim() : "";
  const run = runId ? rt.orchestrator.get(runId) : null;
  const disputeId = run?.pipeline === "dispute-desk" ? (run.state as { disputeId?: unknown }).disputeId : null;
  return run && typeof disputeId === "string" && disputeId ? { runId: run.id, disputeId } : null;
}

export default async function DisputeDeskPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const rt = getRuntime();
  const initialRun = runFromUrl(rt, sp.run);
  let board: Board;
  let error: string | null = null;
  try {
    board = await loadBoard(rt);
  } catch (e) {
    board = emptyBoard(rt.now(), rt.mockRail ? "mock" : "sandbox");
    error = e instanceof Error ? e.message : String(e);
  }
  return (
    <>
      <PipelineHeader pipeline="dispute-desk" title={definition.title} tagline={definition.tagline} primitives={definition.primitives} />
      <DisputeDesk key={initialRun?.runId ?? "desk"} initialBoard={board} initialError={error} initialRun={initialRun} />
    </>
  );
}
