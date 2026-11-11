import type { Metadata } from "next";
import { PipelineHeader } from "@/components/pipeline-header";
import { BOUNTY_PRIMITIVES, BOUNTY_TAGLINE, BOUNTY_TITLE } from "@/pipelines/bounty";
import { buildBoard } from "@/pipelines/bounty/board";
import { getRuntime } from "@/server/runtime";
import { BountyBoard } from "./board";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Bounty Board", description: BOUNTY_TAGLINE };

function one(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export default async function BountyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const rt = getRuntime();
  const initial = buildBoard(rt);
  const runId = one(sp.run);
  // A ?run= link (from the home page, or a pledge) highlights the bounty that run belongs to.
  const run = runId ? rt.orchestrator.get(runId) : null;
  const runBounty = run?.pipeline === "bounty" ? (run.state as { bountyId?: unknown }).bountyId : null;
  const focusBounty = one(sp.bounty) ?? (typeof runBounty === "string" && runBounty ? runBounty : null);
  return (
    <div>
      <PipelineHeader pipeline="bounty" title={BOUNTY_TITLE} tagline={BOUNTY_TAGLINE} primitives={BOUNTY_PRIMITIVES} />
      <BountyBoard initial={initial} focusBounty={focusBounty} returnRunId={runId} />
    </div>
  );
}
