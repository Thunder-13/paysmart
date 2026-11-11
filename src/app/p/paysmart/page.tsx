import type { Metadata } from "next";
import { PipelineHeader } from "@/components/pipeline-header";
import { readChannel3Key } from "@/pipelines/shop/catalog";
import { getRuntime } from "@/server/runtime";
import { PaySmartConsole, type PaySmartModes } from "./paysmart-console";
import { PAYSMART_META } from "@/pipelines/paysmart/meta";
import { initialAsk } from "./view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: { absolute: "PaySmart: say what you need" }, description: PAYSMART_META.tagline };

export default async function PaySmartPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const runId = typeof sp.run === "string" && sp.run ? sp.run : null;
  const rt = getRuntime();
  const modes: PaySmartModes = {
    paypal: rt.config.paypalMode,
    ai: rt.config.aiMode,
    catalog: readChannel3Key() ? "channel3" : "fixtures",
  };
  return (
    <div>
      <PipelineHeader pipeline="paysmart" title={PAYSMART_META.title} tagline={PAYSMART_META.tagline} primitives={[...PAYSMART_META.primitives]} />
      <PaySmartConsole key={runId ?? "new"} initialRunId={runId} initialAsk={initialAsk(sp.ask)} modes={modes} />
    </div>
  );
}
