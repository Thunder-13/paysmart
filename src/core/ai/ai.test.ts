import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AgentStep, AgentTool } from "../contracts";
import { createAnthropicAI } from "./anthropic";
import { createMockAI } from "./mock";

const addTool: AgentTool<{ a: number; b: number }> = {
  name: "add",
  description: "Add two numbers",
  input: z.object({ a: z.number(), b: z.number() }),
  async run({ a, b }) {
    return { sum: a + b };
  },
};
const failTool: AgentTool<{ why: string }> = {
  name: "explode",
  description: "Always fails",
  input: z.object({ why: z.string() }),
  async run({ why }) {
    throw new Error(`boom: ${why}`);
  },
};

describe("mock AI", () => {
  it("json validates the mock against the schema", async () => {
    const ai = createMockAI();
    await expect(ai.json({ label: "x", tier: "fast", system: "", prompt: "", schema: z.object({ n: z.number() }), mock: () => ({ n: 1 }) })).resolves.toEqual({ n: 1 });
    await expect(
      ai.json({ label: "x", tier: "fast", system: "", prompt: "", schema: z.object({ n: z.number() }), mock: () => ({ n: "1" }) as never }),
    ).rejects.toThrow(/does not match/);
    await expect(ai.text({ label: "t", tier: "smart", system: "", prompt: "", mock: () => "hello" })).resolves.toBe("hello");
  });

  it("runAgent replays the script through the real tools", async () => {
    const ai = createMockAI();
    const seen: AgentStep[] = [];
    const res = await ai.runAgent({
      label: "agent",
      tier: "smart",
      system: "",
      task: "",
      tools: [addTool, failTool],
      maxSteps: 10,
      onStep: (s) => seen.push(s),
      mock: [
        { say: "Let me add." },
        { tool: "add", input: { a: 2, b: 3 } },
        { tool: "add", input: { a: "bad" } },
        { tool: "explode", input: { why: "test" } },
        { tool: "missing", input: {} },
        { say: "Done: 5" },
      ],
    });
    expect(res.finalText).toBe("Done: 5");
    expect(seen).toEqual(res.steps);
    expect(res.steps.map((s) => s.kind)).toEqual(["message", "tool_call", "tool_result", "tool_call", "tool_result", "tool_call", "tool_result", "tool_call", "tool_result", "message"]);
    expect(res.steps[2]).toMatchObject({ kind: "tool_result", output: { sum: 5 } });
    expect((res.steps[4] as Extract<AgentStep, { kind: "tool_result" }>).output).toMatchObject({ error: expect.stringContaining("Invalid input") });
    expect((res.steps[6] as Extract<AgentStep, { kind: "tool_result" }>).output).toEqual({ error: "boom: test" });
    expect(res.steps.map((s) => s.index)).toEqual(res.steps.map((_, i) => i));
  });

  it("runAgent stops calling tools after maxSteps", async () => {
    const res = await createMockAI().runAgent({
      label: "a",
      tier: "fast",
      system: "",
      task: "",
      tools: [addTool],
      maxSteps: 1,
      mock: [
        { tool: "add", input: { a: 1, b: 1 } },
        { tool: "add", input: { a: 2, b: 2 } },
      ],
    });
    expect(res.steps.filter((s) => s.kind === "tool_call")).toHaveLength(1);
  });
});

type Params = Record<string, unknown> & { messages: Array<{ role: string; content: unknown }> };

function fakeClient(responses: Array<Record<string, unknown>>) {
  const calls: Params[] = [];
  const client = {
    beta: {
      messages: {
        create: async (params: Params) => {
          calls.push(JSON.parse(JSON.stringify(params)) as Params);
          const next = responses.shift();
          if (!next) throw new Error("no more fake responses");
          return { id: "msg", type: "message", role: "assistant", model: params.model, stop_details: null, usage: {}, ...next };
        },
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

describe("anthropic adapter", () => {
  it("json: submit_result tool with the zod JSON schema, auto tool choice, one repair retry", async () => {
    const { client, calls } = fakeClient([
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu1", name: "submit_result", input: { n: "seven" } }] },
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu2", name: "submit_result", input: { n: 7 } }] },
    ]);
    const ai = createAnthropicAI({ client });
    const out = await ai.json({ label: "num", tier: "smart", system: "sys", prompt: "seven", schema: z.object({ n: z.number() }), mock: () => ({ n: 0 }) });
    expect(out).toEqual({ n: 7 });
    expect(calls[0].model).toBe("claude-sonnet-5-5");
    expect(calls[0].tool_choice).toEqual({ type: "auto" });
    expect(calls[0].fallbacks).toBe("default");
    expect(calls[0].betas).toEqual(["server-side-fallback-2026-07-01"]);
    const tool = (calls[0].tools as Array<{ name: string; input_schema: Record<string, unknown> }>)[0];
    expect(tool.name).toBe("submit_result");
    expect(tool.input_schema).toMatchObject({ type: "object", properties: { n: { type: "number" } } });
    expect(tool.input_schema.$schema).toBeUndefined();
    const repair = calls[1].messages.at(-1)!.content as Array<{ type: string; is_error: boolean; tool_use_id: string }>;
    expect(repair[0]).toMatchObject({ type: "tool_result", tool_use_id: "tu1", is_error: true });
  });

  it("json: fast tier uses the fast model without the fallback beta, and gives up after the repair", async () => {
    const { client, calls } = fakeClient([
      { stop_reason: "end_turn", content: [{ type: "text", text: "{}" }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "still no tool" }] },
    ]);
    const ai = createAnthropicAI({ client, models: { fast: "claude-haiku-5-5", smart: "" } });
    await expect(ai.json({ label: "num", tier: "fast", system: "s", prompt: "p", schema: z.object({ n: z.number() }), mock: () => ({ n: 0 }) })).rejects.toThrow(
      /failed validation after a repair attempt/,
    );
    expect(calls[0].model).toBe("claude-haiku-5-5");
    expect(calls[0].fallbacks).toBeUndefined();
  });

  it("json: wraps non-object schemas and sends images as base64 blocks", async () => {
    const { client, calls } = fakeClient([{ stop_reason: "tool_use", content: [{ type: "tool_use", id: "t", name: "submit_result", input: { value: ["a", "b"] } }] }]);
    const ai = createAnthropicAI({ client });
    const out = await ai.json({
      label: "list",
      tier: "smart",
      system: "s",
      prompt: "p",
      schema: z.array(z.string()),
      images: [{ mediaType: "image/png", base64: "AAAA" }],
      mock: () => [],
    });
    expect(out).toEqual(["a", "b"]);
    const content = calls[0].messages[0].content as Array<Record<string, unknown>>;
    expect(content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } });
    expect(content[1]).toEqual({ type: "text", text: "p" });
  });

  it("text: refusals become errors", async () => {
    const { client } = fakeClient([{ stop_reason: "refusal", content: [], stop_details: { category: "cyber", explanation: "no" } }]);
    await expect(createAnthropicAI({ client }).text({ label: "t", tier: "smart", system: "", prompt: "", mock: () => "" })).rejects.toThrow(/declined "t" \(cyber\)/);
  });

  it("runAgent: runs validated tools, returns errors to the model, and emits steps", async () => {
    const { client, calls } = fakeClient([
      {
        stop_reason: "tool_use",
        content: [
          { type: "text", text: "Adding." },
          { type: "tool_use", id: "a1", name: "add", input: { a: 1, b: 2 } },
          { type: "tool_use", id: "a2", name: "explode", input: { why: "x" } },
        ],
      },
      { stop_reason: "end_turn", content: [{ type: "text", text: "The sum is 3." }] },
    ]);
    const steps: AgentStep[] = [];
    const res = await createAnthropicAI({ client }).runAgent({
      label: "agent",
      tier: "smart",
      system: "s",
      task: "add",
      tools: [addTool, failTool],
      maxSteps: 5,
      mock: [],
      onStep: (s) => steps.push(s),
    });
    expect(res.finalText).toBe("The sum is 3.");
    expect(steps.map((s) => s.kind)).toEqual(["message", "tool_call", "tool_result", "tool_call", "tool_result", "message"]);
    const results = calls[1].messages.at(-1)!.content as Array<{ tool_use_id: string; is_error?: boolean; content: string }>;
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ tool_use_id: "a1", content: '{"sum":3}' });
    expect(results[1]).toMatchObject({ tool_use_id: "a2", is_error: true });
  });
});
