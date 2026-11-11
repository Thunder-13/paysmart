import type { Metadata } from "next";
import { PipelineHeader } from "@/components/pipeline-header";
import { readChannel3Key } from "@/pipelines/shop/catalog";
import { SHOP_META } from "@/pipelines/shop/meta";
import { DEMO_INTENT } from "@/pipelines/shop/types";
import { getRuntime } from "@/server/runtime";
import { ShopConsole, type ShopModes } from "./shop-console";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Shop", description: SHOP_META.tagline };

export default async function ShopPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const runId = typeof sp.run === "string" && sp.run ? sp.run : null;
  const rt = getRuntime();
  const modes: ShopModes = {
    paypal: rt.config.paypalMode,
    ai: rt.config.aiMode,
    catalog: readChannel3Key() ? "channel3" : "fixtures",
  };
  return (
    <div>
      <PipelineHeader pipeline="shop" title={SHOP_META.title} tagline={SHOP_META.tagline} primitives={[...SHOP_META.primitives]} />
      <ShopConsole key={runId ?? "new"} initialRunId={runId} demoIntent={DEMO_INTENT} modes={modes} />
    </div>
  );
}
