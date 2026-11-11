import type { Metadata } from "next";
import { PipelineHeader } from "@/components/pipeline-header";
import { cmpMoney, money } from "@/core/money";
import definition from "@/pipelines/toll-road";
import { readCatalog } from "@/pipelines/toll-road/catalog";
import { prepareCatalog } from "@/pipelines/toll-road/server";
import { DEFAULT_CAP } from "@/pipelines/toll-road/slip";
import { DEFAULT_INTENT, DEFAULT_QUESTION } from "@/pipelines/toll-road/types";
import { getRuntime } from "@/server/runtime";
import { TollRoadView, type PublisherCardData } from "./toll-road-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Toll Road", description: definition.tagline };

export default async function TollRoadPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const runId = typeof sp.run === "string" && sp.run ? sp.run : null;
  const rt = getRuntime();
  prepareCatalog(rt);
  const { publishers, content } = readCatalog(rt.store);
  const cap = money(DEFAULT_CAP);
  const cards: PublisherCardData[] = publishers.map((p) => ({
    id: p.id,
    name: p.name,
    blurb: p.blurb,
    articles: content
      .filter((c) => c.publisherId === p.id)
      .map((c) => ({ id: c.id, title: c.title, summary: c.summary, price: c.price, overCap: cmpMoney(c.price, cap) > 0 })),
  }));

  return (
    <div>
      <PipelineHeader pipeline="toll-road" title={definition.title} tagline={definition.tagline} primitives={definition.primitives} />
      <TollRoadView
        key={runId ?? "new"}
        initialRunId={runId}
        publishers={cards}
        baseUrl={rt.baseUrl}
        defaults={{ question: DEFAULT_QUESTION, intent: DEFAULT_INTENT, cap }}
      />
    </div>
  );
}
