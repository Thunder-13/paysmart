/**
 * Runs pipelines as named steps that can wait on people (PayPal approval, confirmations, uploads).
 * Runs live in store.collection("core", "runs"). Each start/resume drives steps until the run
 * waits, finishes or fails, with a cap of 50 steps per call. Calls on one run are serialized.
 */
import { z } from "zod";
import type {
  AI,
  CoreServices,
  Extractor,
  GuardFn,
  Orchestrator,
  PayPalRail,
  PipelineDefinition,
  PipelineId,
  Run,
  StepContext,
  StepResult,
  Store,
} from "./contracts";
import { appendEvent } from "./events";
import { newId } from "./ids";

export const MAX_STEPS_PER_CALL = 50;

export interface OrchestratorDeps {
  rail: PayPalRail;
  ai: AI;
  extractor: Extractor;
  guard: GuardFn;
  store: Store;
  core: CoreServices;
  baseUrl: string;
  now(): Date;
}

export class RunInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunInputError";
  }
}

export class RunStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunStateError";
  }
}

/** Orchestrator plus non-blocking variants used by the HTTP routes (202 + background execution). */
export interface AppOrchestrator extends Orchestrator {
  /** Validates and saves the run, returns its snapshot now; `done` settles when the run stops. */
  begin(pipeline: PipelineId, input: unknown): { run: Run; done: Promise<Run> };
  /** Checks the run is waiting, marks it running, returns the snapshot now; `done` settles later. */
  beginResume(runId: string, signal: unknown): { run: Run; done: Promise<Run> };
}

type AnyRun = Run<Record<string, unknown>>;

function message(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  return typeof e === "string" ? e : JSON.stringify(e);
}

export function createOrchestrator(opts: {
  pipelines: Partial<Record<PipelineId, PipelineDefinition>>;
  deps: OrchestratorDeps;
}): AppOrchestrator {
  const { pipelines, deps } = opts;
  const runs = deps.store.collection<AnyRun>("core", "runs");
  const locks = new Map<string, Promise<unknown>>();

  function save(run: AnyRun): AnyRun {
    const next = { ...run, updatedAt: deps.now().toISOString() };
    runs.put(next.id, next);
    return next;
  }

  function slipEvent(run: AnyRun, type: "run.step" | "run.waiting" | "run.done" | "run.failed", data: unknown): void {
    if (!run.slipId) return;
    try {
      deps.store.ledger.append(run.slipId, type, "system", data);
    } catch {
      // A ledger hiccup must not change the run's outcome.
    }
  }

  function withLock<T>(runId: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(runId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => undefined);
    locks.set(runId, tail);
    void tail.then(() => {
      if (locks.get(runId) === tail) locks.delete(runId);
    });
    return next;
  }

  async function drive(runId: string, firstSignal: unknown): Promise<AnyRun> {
    let run = runs.get(runId);
    if (!run) throw new RunStateError(`run ${runId} not found`);
    const def = pipelines[run.pipeline];
    if (!def) {
      run = save({ ...run, status: "failed", error: `Unknown pipeline: ${run.pipeline}` });
      return run;
    }
    let signal = firstSignal;
    // ctx.log lines written before the run has a slip are held and flushed once it gets one.
    const pendingNotes: { message: string; runId: string; step: string; data?: unknown }[] = [];
    const flushNotes = (slipId: string | null) => {
      if (!slipId) return;
      for (const note of pendingNotes.splice(0)) appendEvent(deps.store.ledger, slipId, "note", "agent", note);
    };
    for (let i = 0; i < MAX_STEPS_PER_CALL; i++) {
      const stepName = run.step;
      const stepFn = def.steps[stepName];
      if (!stepFn) {
        run = save({ ...run, status: "failed", error: `Unknown step "${stepName}" in ${run.pipeline}` });
        slipEvent(run, "run.failed", { runId: run.id, step: stepName, error: run.error });
        return run;
      }
      const current: AnyRun = run;
      const ctx: StepContext<Record<string, unknown>> = {
        run: current,
        signal,
        rail: deps.rail,
        ai: deps.ai,
        extractor: deps.extractor,
        guard: deps.guard,
        store: deps.store,
        core: deps.core,
        baseUrl: deps.baseUrl,
        now: () => deps.now(),
        log: (msg: string, data?: unknown) => {
          const slipId = runs.get(current.id)?.slipId ?? current.slipId;
          pendingNotes.push({ message: msg, runId: current.id, step: stepName, data });
          flushNotes(slipId);
        },
      };
      signal = undefined;

      let result: StepResult<Record<string, unknown>>;
      try {
        result = await stepFn(ctx);
      } catch (e) {
        run = save({ ...(runs.get(run.id) ?? run), status: "failed", wait: null, error: message(e) });
        slipEvent(run, "run.failed", { runId: run.id, step: stepName, error: run.error });
        return run;
      }

      const latest = runs.get(run.id) ?? run;
      if ("fail" in result) {
        run = save({ ...latest, status: "failed", wait: null, error: result.fail });
        slipEvent(run, "run.failed", { runId: run.id, step: stepName, error: result.fail });
        return run;
      }
      const state = { ...latest.state, ...(result.state ?? {}) };
      const slipId = result.slipId ?? latest.slipId;
      flushNotes(slipId);
      if ("done" in result) {
        run = save({ ...latest, state, slipId, status: "done", wait: null, error: null });
        slipEvent(run, "run.done", { runId: run.id, step: stepName, status: "done" });
        return run;
      }
      if ("wait" in result) {
        run = save({ ...latest, state, slipId, status: "waiting", wait: result.wait, step: result.resumeAt, error: null });
        slipEvent(run, "run.waiting", { runId: run.id, step: result.resumeAt, wait: result.wait });
        return run;
      }
      run = save({ ...latest, state, slipId, status: "running", wait: null, step: result.next, error: null });
      slipEvent(run, "run.step", { runId: run.id, step: stepName, next: result.next });
    }
    const error = `Stopped after ${MAX_STEPS_PER_CALL} steps without waiting or finishing (last step "${run.step}").`;
    run = save({ ...run, status: "failed", error });
    slipEvent(run, "run.failed", { runId: run.id, step: run.step, error });
    return run;
  }

  function guarded(runId: string, signal: unknown): Promise<AnyRun> {
    return withLock(runId, async () => {
      try {
        return await drive(runId, signal);
      } catch (e) {
        const run = runs.get(runId);
        if (!run) throw e;
        const failed = save({ ...run, status: "failed", wait: null, error: message(e) });
        slipEvent(failed, "run.failed", { runId, step: failed.step, error: failed.error });
        return failed;
      }
    });
  }

  const orchestrator: AppOrchestrator = {
    begin(pipeline, input) {
      const def = pipelines[pipeline];
      if (!def) throw new RunInputError(`Unknown pipeline: ${String(pipeline)}`);
      const parsed = def.input.safeParse(input);
      if (!parsed.success) {
        throw new RunInputError(`Invalid input for ${pipeline}: ${z.prettifyError(parsed.error)}`);
      }
      const at = deps.now().toISOString();
      const run = save({
        id: newId("run"),
        pipeline,
        slipId: null,
        status: "running",
        step: def.firstStep,
        state: def.initialState(parsed.data) as Record<string, unknown>,
        wait: null,
        error: null,
        createdAt: at,
        updatedAt: at,
      });
      return { run, done: guarded(run.id, undefined) };
    },

    beginResume(runId, signal) {
      const run = runs.get(runId);
      if (!run) throw new RunStateError(`run ${runId} not found`);
      if (run.status !== "waiting") throw new RunStateError(`run ${runId} is ${run.status}, not waiting`);
      const running = save({ ...run, status: "running", wait: null });
      return { run: running, done: guarded(runId, signal) };
    },

    async start(pipeline, input) {
      return orchestrator.begin(pipeline, input).done;
    },

    async resume(runId, signal) {
      return orchestrator.beginResume(runId, signal).done;
    },

    get(runId) {
      return runs.get(runId);
    },

    list(filter = {}) {
      return runs
        .list()
        .filter((r) => (!filter.pipeline || r.pipeline === filter.pipeline) && (!filter.status || r.status === filter.status))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
  };
  return orchestrator;
}
