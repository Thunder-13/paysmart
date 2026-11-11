import type { Metadata } from "next";
import { PipelineHeader } from "@/components/pipeline-header";
import cashWeather from "@/pipelines/cash-weather";
import { getRuntime } from "@/server/runtime";
import { CashWeatherConsole } from "./cash-weather-console";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Cash Weather", description: cashWeather.tagline };

export default async function CashWeatherPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const runId = typeof sp.run === "string" && sp.run.trim() !== "" ? sp.run.trim() : null;
  const { config } = getRuntime();
  const parts = [
    config.paypalMode === "mock" ? "simulated PayPal with the sample studio's history" : null,
    config.aiMode === "mock" ? "scripted AI text" : null,
  ].filter(Boolean);
  const modeNote = parts.length > 0 ? `Demo mode: ${parts.join(", ")}.` : null;
  return (
    <div>
      <PipelineHeader pipeline="cash-weather" title={cashWeather.title} tagline={cashWeather.tagline} primitives={cashWeather.primitives} />
      <CashWeatherConsole key={runId ?? "new"} initialRunId={runId} modeNote={modeNote} />
    </div>
  );
}
