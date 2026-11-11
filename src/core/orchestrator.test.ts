import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { PipelineDefinition } from "./contracts";
import { MAX_STEPS_PER_CALL, RunInputError } from "./orchestrator";
import { PayPalError } from "./rail/errors";
import { coreRuntime, newSlipInput } from "./test-helpers";

type State = { name: string; approved?: boolean; orderId?: string; count: number };

const signingPipeline: PipelineDefinition<{ name: string }, State> = {
  id: "shop",
  title: "Test shop",
  tagline: "t",
  primitives: [],
  input: z.object({ name: z.string().min(1) }),
  initialState: (input) => ({ name: input.name, count: 0 }),
  firstStep: "create",
  steps: {
    async create(ctx) {
      const slip = ctx.core.createSlip(newSlipInput({ intent: `toy for ${ctx.run.state.name}` }));
      ctx.log("slip created");
      return { next: "sign", slipId: slip.id };
    },
    async sign(ctx) {
      const { approveUrl, orderId } = await ctx.core.beginSigning(ctx.run.slipId!, { intent: "AUTHORIZE", returnPath: "/p/shop" });
      return { wait: { kind: "paypal_approval", message: "Sign the slip", data: { approveUrl } }, resumeAt: "signed", state: { orderId } };
    },
    async signed(ctx) {
      const signal = ctx.signal as { approved: boolean };
      if (!signal.approved) return { fail: "Buyer cancelled" };
      await ctx.core.completeSigning(ctx.run.slipId!);
      return { done: true, state: { approved: true } };
    },
  },
};

describe("orchestrator", () => {
  it("runs to a wait, resumes with the signal, and logs run events on the slip chain", async () => {
    const rt = coreRuntime({ pipelines: { shop: signingPipeline } });
    const run = await rt.orchestrator.start("shop", { name: "Sam" });
    expect(run.status).toBe("waiting");
    expect(run.step).toBe("signed");
    expect(run.wait?.kind).toBe("paypal_approval");
    expect(run.slipId).toMatch(/^slip_/);
    rt.mockRail.approveOrder(run.state.orderId as string, "buyer@example.com");
    const done = await rt.orchestrator.resume(run.id, { approved: true, orderId: run.state.orderId });
    expect(done.status).toBe("done");
    expect(done.state).toMatchObject({ name: "Sam", approved: true });
    const types = rt.store.ledger.list(run.slipId!).map((e) => e.type);
    expect(types).toContain("note");
    expect(types).toContain("run.step");
    expect(types).toContain("run.waiting");
    expect(types.at(-1)).toBe("run.done");
    expect(rt.orchestrator.list({ pipeline: "shop", status: "done" }).map((r) => r.id)).toEqual([run.id]);
  });

  it("only resumes waiting runs, with a clear error", async () => {
    const rt = coreRuntime({ pipelines: { shop: signingPipeline } });
    const run = await rt.orchestrator.start("shop", { name: "Sam" });
    await rt.orchestrator.resume(run.id, { approved: false });
    await expect(rt.orchestrator.resume(run.id, { approved: true })).rejects.toThrow(`run ${run.id} is failed, not waiting`);
  });

  it("serializes concurrent resumes: the second one sees the run is not waiting", async () => {
    const rt = coreRuntime({ pipelines: { shop: signingPipeline } });
    const run = await rt.orchestrator.start("shop", { name: "Sam" });
    rt.mockRail.approveOrder(run.state.orderId as string, "buyer@example.com");
    const a = rt.orchestrator.resume(run.id, { approved: true });
    const b = rt.orchestrator.resume(run.id, { approved: true });
    await expect(b).rejects.toThrow(/not waiting/);
    expect((await a).status).toBe("done");
  });

  it("rejects invalid input before creating a run", async () => {
    const rt = coreRuntime({ pipelines: { shop: signingPipeline } });
    await expect(rt.orchestrator.start("shop", { name: "" })).rejects.toBeInstanceOf(RunInputError);
    expect(rt.orchestrator.list()).toHaveLength(0);
  });

  it("turns thrown errors into failed runs, keeping PayPal's debug_id in the message", async () => {
    const failing: PipelineDefinition = {
      ...signingPipeline,
      steps: {
        async create(ctx) {
          const slip = ctx.core.createSlip(newSlipInput());
          return { next: "boom", slipId: slip.id };
        },
        async boom() {
          throw new PayPalError({ name: "UNPROCESSABLE_ENTITY", message: "Nope", debug_id: "abc123", status: 422, details: [{ issue: "AUTHORIZATION_VOIDED" }] });
        },
      },
    };
    const rt = coreRuntime({ pipelines: { shop: failing } });
    const run = await rt.orchestrator.start("shop", { name: "x" });
    expect(run.status).toBe("failed");
    expect(run.error).toContain("debug_id abc123");
    expect(run.error).toContain("AUTHORIZATION_VOIDED");
    const last = rt.store.ledger.list(run.slipId!).at(-1)!;
    expect(last.type).toBe("run.failed");
    expect(last.data).toMatchObject({ runId: run.id, step: "boom" });
  });

  it("fails a run that loops past the step cap", async () => {
    let calls = 0;
    const looping: PipelineDefinition = {
      ...signingPipeline,
      firstStep: "spin",
      steps: {
        async spin() {
          calls += 1;
          return { next: "spin" };
        },
      },
    };
    const rt = coreRuntime({ pipelines: { shop: looping } });
    const run = await rt.orchestrator.start("shop", { name: "x" });
    expect(run.status).toBe("failed");
    expect(run.error).toContain(`${MAX_STEPS_PER_CALL} steps`);
    expect(calls).toBe(MAX_STEPS_PER_CALL);
  });

  it("fails on a missing step and an explicit fail result", async () => {
    const broken: PipelineDefinition = { ...signingPipeline, firstStep: "nowhere" };
    const rt = coreRuntime({ pipelines: { shop: broken } });
    expect((await rt.orchestrator.start("shop", { name: "x" })).error).toContain('Unknown step "nowhere"');
  });

  it("begin returns a running snapshot immediately and finishes in the background", async () => {
    const rt = coreRuntime({ pipelines: { shop: signingPipeline } });
    const { run, done } = rt.orchestrator.begin("shop", { name: "Sam" });
    expect(run.status).toBe("running");
    expect(rt.orchestrator.get(run.id)?.status).toBe("running");
    expect((await done).status).toBe("waiting");
    const resumed = rt.orchestrator.beginResume(run.id, { approved: false });
    expect(resumed.run.status).toBe("running");
    expect((await resumed.done).status).toBe("failed");
  });
});
