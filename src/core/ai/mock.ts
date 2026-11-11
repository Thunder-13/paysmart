/**
 * Scripted AI for offline runs and tests. json/text return the caller's deterministic mock.
 * runAgent replays the MockAgentScript through the REAL tools: inputs are validated with each
 * tool's zod schema, tools run, and every call/result/message is emitted as a step.
 * Like the live adapter, it never writes to the ledger.
 */
import type { AgentStep, AI, AgentTool } from "../contracts";
import { describeZodError, errorMessage } from "./schema";

export async function runTool(
  tool: AgentTool<unknown> | undefined,
  name: string,
  input: unknown,
): Promise<{ output: unknown; isError: boolean }> {
  if (!tool) return { output: { error: `Unknown tool "${name}"` }, isError: true };
  const parsed = tool.input.safeParse(input);
  if (!parsed.success) {
    return { output: { error: `Invalid input for ${name}: ${describeZodError(parsed.error)}` }, isError: true };
  }
  try {
    return { output: await tool.run(parsed.data), isError: false };
  } catch (e) {
    return { output: { error: errorMessage(e) }, isError: true };
  }
}

export function createMockAI(): AI {
  return {
    mode: "mock",

    async json(req) {
      const value = req.mock();
      const parsed = req.schema.safeParse(value);
      if (!parsed.success) {
        throw new Error(`Mock for "${req.label}" does not match its schema: ${describeZodError(parsed.error)}`);
      }
      return parsed.data;
    },

    async text(req) {
      return req.mock();
    },

    async runAgent(req) {
      const steps: AgentStep[] = [];
      const emit = (step: AgentStep) => {
        steps.push(step);
        req.onStep?.(step);
      };
      let finalText = "";
      let toolCalls = 0;
      for (const entry of req.mock) {
        if ("say" in entry) {
          emit({ index: steps.length, kind: "message", text: entry.say });
          finalText = entry.say;
          continue;
        }
        if (toolCalls >= req.maxSteps) break;
        toolCalls += 1;
        emit({ index: steps.length, kind: "tool_call", name: entry.tool, input: entry.input });
        const tool = req.tools.find((t) => t.name === entry.tool) as AgentTool<unknown> | undefined;
        const { output } = await runTool(tool, entry.tool, entry.input);
        emit({ index: steps.length, kind: "tool_result", name: entry.tool, output });
      }
      return { finalText, steps };
    },
  };
}
