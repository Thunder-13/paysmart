import Link from "next/link";
import { connection } from "next/server";
import { ViewTransition } from "react";
import { PIPELINE_IDS, type PipelineId, type RunStatus } from "@/core/contracts";
import { formatMoney, isZero } from "@/core/money";
import { PLATE_SKINS } from "@/components/plate-skins";
import { shortTime } from "@/components/slip-figures";
import { pipelines } from "@/pipelines/registry";
import { resolveConfig } from "@/server/config";
import { readDemoStory } from "@/server/demo-restore";
import { featuredRuns, type FeaturedRun } from "@/server/featured-runs";
import { consoleFigures, type PipelineFigures } from "@/server/ledger-figures";
import { getRuntime } from "@/server/runtime";

const FALLBACK: Record<PipelineId, { title: string; line: string }> = {
  shop: {
    title: "Permission Slip shopping",
    line: "Say what you want in plain words. The agent can only buy what the slip allows.",
  },
  "second-look": {
    title: "Second Look",
    line: "A scam check before you pay a stranger, then a protected PayPal payment.",
  },
  bounty: {
    title: "Bounty Board",
    line: "Backers pledge, a photo proves the work, and Payouts pay the hunter.",
  },
  "cash-weather": {
    title: "Cash Weather",
    line: "A cash forecast from your PayPal history, invoice nudges, and thank-you payouts.",
  },
  "toll-road": {
    title: "Toll Road",
    line: "AI agents pay per fetch with HTTP 402, settled on PayPal.",
  },
  "dispute-desk": {
    title: "Dispute Desk",
    line: "Answer PayPal disputes with hash-chained slip evidence.",
  },
  paysmart: {
    title: "PaySmart",
    line: "Say what you need. The agent shops, every other pipeline screens, you pick, PayPal pays.",
  },
};

export function describePipeline(id: PipelineId): { title: string; line: string } {
  const def = pipelines[id];
  const built = def && def.title && !/not built/i.test(def.title);
  return {
    title: built ? def.title : FALLBACK[id].title,
    line: built && def.tagline ? def.tagline : FALLBACK[id].line,
  };
}

/* -------------------------------------------------------- pipeline plates */

/** Grid placement per plate, the Shop plate the largest. Colours live in plate-skins.ts so the header morph keeps them. */
const PLATE: Record<PipelineId, { area: string; tall?: boolean }> = {
  shop: { area: "lg:col-span-7", tall: true },
  "second-look": { area: "lg:col-span-5" },
  bounty: { area: "lg:col-span-5" },
  "cash-weather": { area: "lg:col-span-7" },
  "toll-road": { area: "lg:col-span-7" },
  "dispute-desk": { area: "lg:col-span-5" },
  // PaySmart is the home hero (paysmart-band.tsx), not a plate; this entry only satisfies the record type.
  paysmart: { area: "lg:col-span-12" },
};

/** The grid keeps its six plates; PaySmart is the front-door hero, not a seventh plate. */
const GRID_IDS = PIPELINE_IDS.filter((id) => id !== "paysmart");

function Figure({ money, label }: { money: PipelineFigures["moved"]; label: string }) {
  return (
    <span className="flex flex-col">
      <data value={`${money.value} ${money.currency}`} className="font-display text-figure font-extrabold leading-none tabular-nums tracking-tight">
        {formatMoney(money)}
      </data>
      <span className="mt-1.5 text-sm">{label}</span>
    </span>
  );
}

function FiguresLine({ f, soft }: { f: PipelineFigures | null; soft: string }) {
  if (!f) return <span className={`block text-sm ${soft}`}>Loading figures…</span>;
  if (f.slips === 0 && f.runs === 0) return <span className={`block text-sm ${soft}`}>No runs yet.</span>;
  return (
    <span className="block">
      <span className="flex flex-wrap gap-x-8 gap-y-4">
        {!isZero(f.captured) ? <Figure money={f.captured} label="captured" /> : null}
        {!isZero(f.paidOut) ? <Figure money={f.paidOut} label="paid out" /> : null}
        {!isZero(f.refunded) ? <Figure money={f.refunded} label="refunded" /> : null}
      </span>
      <span className={`mt-3 flex flex-wrap gap-x-4 text-sm ${soft}`}>
        <span>
          <span className="font-semibold tabular-nums">{f.slips}</span> {f.slips === 1 ? "slip" : "slips"}
        </span>
        <span>
          <span className="font-semibold tabular-nums">{f.runs}</span> {f.runs === 1 ? "run" : "runs"}
        </span>
        {isZero(f.moved) && isZero(f.refunded) ? <span>no money moved</span> : null}
        {f.chain.slips > 0 && !f.chain.ok ? <span className="font-semibold">chain broken</span> : null}
      </span>
    </span>
  );
}

const RUN_STATUS_WORDS: Record<RunStatus, string> = {
  running: "running",
  waiting: "waiting",
  done: "finished",
  failed: "failed",
};

/** What the plate's main link opens: the demo run, the latest run, or nothing yet. */
function RunCue({ run, cue, soft }: { run: FeaturedRun; cue: string; soft: string }) {
  return (
    <span className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className={`plate-cue inline-flex h-10 items-center whitespace-nowrap rounded-pill px-5 text-sm font-semibold transition-colors duration-[120ms] ${cue}`}>
        {run.label ? "Open the demo run" : `Open the latest run (${RUN_STATUS_WORDS[run.status]})`}
      </span>
      {run.label ? <span className={`text-sm ${soft}`}>{run.label}</span> : null}
    </span>
  );
}

const CHIP_MAX = 4;

/** The mechanism: the PayPal and AI capabilities this pipeline really calls, in the plate's chip skin. */
function Mechanism({ id, chip, soft }: { id: PipelineId; chip: string; soft: string }) {
  const list = pipelines[id]?.primitives ?? [];
  if (list.length === 0) return null;
  const shown = list.slice(0, CHIP_MAX);
  const more = list.length - shown.length;
  return (
    <span className="mt-6 block">
      <span className={`block text-sm ${soft}`}>PayPal and AI it uses</span>
      <span className="mt-2 flex flex-wrap gap-1.5">
        {shown.map((x) => (
          <span key={x} className={`rounded-pill px-3 py-1 text-sm font-semibold ${chip}`}>
            {x}
          </span>
        ))}
        {more > 0 ? <span className={`px-1 py-1 text-sm font-semibold ${soft}`}>+{more} more</span> : null}
      </span>
    </span>
  );
}

function PipelineGrid({ figures, runs }: { figures: Record<PipelineId, PipelineFigures> | null; runs: Record<PipelineId, FeaturedRun | null> | null }) {
  return (
    <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-12">
      {GRID_IDS.map((id) => {
        const p = describePipeline(id);
        const run = runs ? runs[id] : null;
        const place = PLATE[id];
        const look = { ...place, ...PLATE_SKINS[id] };
        return (
          <ViewTransition key={id} name={`plate-${id}`}>
          <li style={{ "--i": GRID_IDS.indexOf(id) } as React.CSSProperties} className={`plate-card group relative flex flex-col overflow-hidden rounded-2xl ${look.skin} ${look.area}`}>
            <Link
              href={run ? `/p/${id}?run=${encodeURIComponent(run.runId)}` : `/p/${id}`}
              className={`flex flex-1 flex-col rounded-2xl p-7 focus-visible:-outline-offset-4 ${look.tall ? "lg:p-10" : ""}`}
            >
              <span className={`font-display font-extrabold tracking-tight ${look.tall ? "text-4xl lg:text-5xl" : "text-2xl"}`}>{p.title}</span>
              <span className={`mt-2 block max-w-[46ch] ${look.tall ? "text-lg" : "text-base"} ${look.soft}`}>{p.line}</span>
              <span className={`block ${look.tall ? "mt-10" : "mt-6"}`}>
                <FiguresLine f={figures ? figures[id] : null} soft={look.soft} />
              </span>
              <Mechanism id={id} chip={look.chip} soft={look.soft} />
              <span className="mt-auto block">
                {run ? (
                  <RunCue run={run} cue={look.cue} soft={look.soft} />
                ) : (
                  <span className="mt-6 flex">
                    <span className={`plate-cue inline-flex h-10 items-center whitespace-nowrap rounded-pill px-5 text-sm font-semibold transition-colors duration-[120ms] ${look.cue}`}>
                      Start the first run
                    </span>
                  </span>
                )}
                <span className={`mt-4 block font-mono text-xs ${look.soft}`}>/p/{id}</span>
              </span>
            </Link>
            {run ? (
              <Link
                href={`/p/${id}`}
                className={`mx-7 mb-6 self-start rounded-sm text-sm font-semibold underline decoration-current/40 underline-offset-4 hover:decoration-current ${look.tall ? "lg:mx-10 lg:mb-9" : ""}`}
              >
                Start a new run<span className="sr-only"> in {p.title}</span>
              </Link>
            ) : null}
          </li>
          </ViewTransition>
        );
      })}
    </ul>
  );
}

async function DemoStoryIntro() {
  await connection();
  const config = resolveConfig();
  if (config.paypalMode !== "mock" || config.aiMode !== "mock") return null;
  const doc = readDemoStory(getRuntime().store);
  const loaded = doc?.status === "loaded";
  return (
    <p className="mt-5 max-w-[70ch] text-base text-ink-soft">
      This server runs in mock mode, so no real money moves. Load the demo story to fill every pipeline with a finished run: a hijacked listing stamped outside
      the slip, a protected payment, a paid bounty, maintainer payouts, a metered crawl, an answered dispute and a PaySmart cart.
      {loaded && doc?.finishedAt ? ` Loaded ${shortTime(doc.finishedAt)}. Each card below opens its demo run.` : ""}
    </p>
  );
}

async function LivePipelines() {
  await connection();
  const rt = getRuntime();
  const { pipelines: figures } = consoleFigures(rt);
  return <PipelineGrid figures={figures} runs={featuredRuns(rt)} />;
}

export function PipelinesSection() {
  return (
      <section aria-labelledby="pipelines-heading" className="container-page mt-32">
        <div className="mb-10 max-w-[70ch]">
          <h2 id="pipelines-heading" className="font-display text-section font-extrabold leading-[1.02] tracking-[-0.03em] text-ink">
            Inside PaySmart: six pipelines, one guard.
          </h2>
          <p className="mt-5 max-w-[60ch] text-lg text-ink-soft">PaySmart hands each part of your ask to the pipeline built for it. Each one also runs on its own page.</p>
          <DemoStoryIntro />
        </div>
        <LivePipelines />
      </section>
  );
}
