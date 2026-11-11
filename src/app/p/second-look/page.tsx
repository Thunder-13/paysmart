import type { Metadata } from "next";
import { PipelineHeader } from "@/components/pipeline-header";
import secondLook from "@/pipelines/second-look";
import { getRuntime } from "@/server/runtime";
import { SecondLookClient } from "./second-look-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Second Look", description: secondLook.tagline };

export default async function SecondLookPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const runId = typeof sp.run === "string" && sp.run.trim() !== "" ? sp.run.trim() : null;
  const { config } = getRuntime();
  // In sandbox mode the sample sellers must be a real sandbox account, or PayPal rejects the payee.
  const sandboxSellerEmail = config.paypalMode === "sandbox" ? process.env.SECOND_LOOK_SELLER_EMAIL?.trim() || null : null;
  return (
    <div>
      <PipelineHeader pipeline="second-look" title={secondLook.title} tagline={secondLook.tagline} primitives={secondLook.primitives} />
      <SecondLookClient
        key={runId ?? "new"}
        initialRunId={runId}
        sandboxSellerEmail={sandboxSellerEmail}
        simulated={config.paypalMode === "mock"}
        scriptedAI={config.aiMode === "mock"}
      />
    </div>
  );
}
