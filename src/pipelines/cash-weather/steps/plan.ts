/**
 * forecast -> narrate -> upstream -> budget. Pure modules do the numbers; the AI writes words.
 */
import type { StepContext, StepResult } from "@/core/contracts";
import { toCents } from "@/core/money";
import type { CashWeatherState, Notice } from "../types";
import { forecast } from "../forecast";
import { narrate } from "../narrative";
import { fetchPackageMeta, type FetchLike } from "../registry";
import { REGISTRY_FIXTURE } from "../fixtures";
import { allocate, receiverMap } from "../allocation";
import { explainAllocation, parseDependencies } from "../upstream";
import { buildGive } from "../budget";

type Ctx = StepContext<CashWeatherState>;
type Res = StepResult<CashWeatherState>;

/** Test seam for the registry fetch; production uses global fetch. */
export const upstreamDeps: { fetch: FetchLike | undefined } = { fetch: undefined };

export async function forecastStep(ctx: Ctx): Promise<Res> {
  const s = ctx.run.state;
  if (!s.asOf) return { fail: "forecast ran before ingest" };
  const result = forecast({
    asOf: s.asOf,
    seed: s.input.seed,
    startCents: toCents(s.input.currentBalance),
    bufferCents: toCents(s.input.safetyBuffer),
    transactions: s.transactions,
    invoices: s.invoices,
  });
  const notices: Notice[] = [];
  if (result.excludedCurrencyCount > 0) {
    const n = result.excludedCurrencyCount;
    notices.push({ id: "currency", level: "info", text: `${n} transaction${n === 1 ? "" : "s"} in another currency ${n === 1 ? "is" : "are"} left out of this USD forecast.` });
  }
  return { next: "narrate", state: { forecast: result, notices: [...s.notices, ...notices] } };
}

export async function narrateStep(ctx: Ctx): Promise<Res> {
  const f = ctx.run.state.forecast;
  if (!f) return { fail: "narrate ran before forecast" };
  return { next: "upstream", state: { narrative: await narrate(ctx.ai, f) } };
}

export async function upstreamStep(ctx: Ctx): Promise<Res> {
  const s = ctx.run.state;
  const deps = parseDependencies(s.input.packageJson);
  const live = ctx.rail.mode === "sandbox" && process.env.CASH_WEATHER_NPM_LIVE !== "0";
  const metas = await fetchPackageMeta(deps.names, {
    mode: live ? "live" : "fixtures",
    fixtures: REGISTRY_FIXTURE,
    fetchImpl: upstreamDeps.fetch,
  });
  const { map, problem } = receiverMap(process.env.CASH_WEATHER_RECEIVERS_JSON);
  const { packages, receivers } = allocate(metas, map, s.input.importCounts);
  const hinted = !!s.input.importCounts && Object.keys(s.input.importCounts).length > 0;
  const explanation = await explainAllocation(ctx.ai, packages, receivers, hinted);

  const notices: Notice[] = [];
  const offline = packages.filter((p) => p.offline).map((p) => p.name);
  if (offline.length > 0) {
    notices.push({ id: "npm-offline", level: "warn", text: `The npm registry could not be read for ${offline.join(", ")}; those rows use offline data.` });
  }
  if (problem) notices.push({ id: "receivers", level: "warn", text: problem });
  if (deps.rejected.length > 0) {
    notices.push({ id: "npm-rejected", level: "warn", text: `Ignored ${deps.rejected.length} dependency name${deps.rejected.length === 1 ? "" : "s"} that npm would not accept.` });
  }
  return {
    next: "budget",
    state: {
      upstream: {
        packages,
        receivers,
        rejected: deps.rejected,
        skipped: deps.skipped,
        explanation: explanation.text,
        explanationSource: explanation.source,
        registryMode: live ? "live" : "fixtures",
      },
      notices: [...s.notices, ...notices],
    },
  };
}

export async function budgetStep(ctx: Ctx): Promise<Res> {
  const s = ctx.run.state;
  if (!s.forecast || !s.upstream) return { fail: "budget ran before forecast and upstream" };
  const give = buildGive({
    day30P10Cents: s.forecast.p10[30],
    bufferCents: toCents(s.input.safetyBuffer),
    capCents: toCents(s.input.monthlyCap),
    receivers: s.upstream.receivers,
  });
  return { next: "draft_slip", state: { give } };
}
