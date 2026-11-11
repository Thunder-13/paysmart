/**
 * The run each home card opens. The demo story's main run wins when the story is loaded (for Shop
 * that is the red-team run that ends refunded); otherwise the pipeline's most recent run.
 */
import { PIPELINE_IDS, type PipelineId, type Run, type RunStatus, type Store } from "@/core/contracts";
import { readDemoStory } from "./demo-restore";

export interface FeaturedRun {
  runId: string;
  status: RunStatus;
  /** The demo story's caption, when this is the demo run. */
  label: string | null;
}

/** A bounty pledge is a side trip: the board reads ?run= of a pledge as a PayPal return. */
function standsForPipeline(run: Run): boolean {
  return !(run.pipeline === "bounty" && (run.state as { kind?: unknown }).kind === "pledge");
}

export function featuredRuns(rt: {
  store: Store;
  orchestrator: { get(runId: string): Run | null; list(filter?: { pipeline?: PipelineId }): Run[] };
}): Record<PipelineId, FeaturedRun | null> {
  const doc = readDemoStory(rt.store);
  const story = doc?.status === "loaded" ? doc.runs.filter((r) => r.role === "main") : [];
  const all = [...rt.orchestrator.list()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const out = {} as Record<PipelineId, FeaturedRun | null>;
  for (const id of PIPELINE_IDS) {
    const demo = story.find((r) => r.pipeline === id);
    const demoRun = demo ? rt.orchestrator.get(demo.runId) : null;
    if (demo && demoRun) {
      out[id] = { runId: demoRun.id, status: demoRun.status, label: demo.label };
      continue;
    }
    const latest = all.find((r) => r.pipeline === id && standsForPipeline(r));
    out[id] = latest ? { runId: latest.id, status: latest.status, label: null } : null;
  }
  return out;
}
