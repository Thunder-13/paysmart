/**
 * Live AI adapter over @anthropic-ai/sdk.
 *
 * - json(): one "submit_result" tool whose input_schema is z.toJSONSchema(schema). Claude Sonnet 5.5
 *   rejects forced tool_choice ("any"/"tool") with a 400, so the call uses tool_choice "auto" plus an
 *   explicit instruction, then validates with zod and allows one repair retry.
 * - text(): plain completion.
 * - runAgent(): manual tool-use loop; tool inputs validated with each tool's zod schema; tool errors
 *   go back to the model as is_error results; onStep fires for every call, result and message.
 *   It never writes to the ledger (it has no slip); pipelines log "agent.step" via onStep.
 * - Models whose family supports it get the server-side refusal fallback ("default" form).
 */
import Anthropic from "@anthropic-ai/sdk";
import type { AgentStep, AgentTool, AI, ImageInput, ModelTier } from "../contracts";
import { runTool } from "./mock";
import { describeZodError, toToolSchema, unwrapToolInput } from "./schema";

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentBlockParam = Anthropic.Beta.BetaContentBlockParam;
type ToolResultBlockParam = Anthropic.Beta.BetaToolResultBlockParam;
type BetaMessage = Anthropic.Beta.BetaMessage;
type ToolUseBlock = Anthropic.Beta.BetaToolUseBlock;

export interface AnthropicAIOptions {
  apiKey?: string;
  models?: Partial<Record<ModelTier, string>>;
  /** Injected for tests. */
  client?: Anthropic;
  maxTokens?: number;
}

export const DEFAULT_MODELS: Record<ModelTier, string> = {
  smart: "claude-sonnet-5-5",
  fast: "claude-haiku-5-5",
};

const SUBMIT_TOOL = "submit_result";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
/** Model families that accept `fallbacks: "default"` on the Claude API. */
const FALLBACK_MODELS = /^claude-(sonnet-5-5|opus-5-5|opus-5|fable-5-1)$/;

function userContent(prompt: string, images?: ImageInput[]): ContentBlockParam[] {
  const blocks: ContentBlockParam[] = (images ?? []).map((img) => ({
    type: "image",
    source: { type: "base64", media_type: img.mediaType, data: img.base64 },
  }));
  blocks.push({ type: "text", text: prompt });
  return blocks;
}

function textOf(message: BetaMessage): string {
  return message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function toolUses(message: BetaMessage): ToolUseBlock[] {
  return message.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
}

function stringifyOutput(output: unknown): string {
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output ?? null);
  } catch {
    return String(output);
  }
}

export function createAnthropicAI(opts: AnthropicAIOptions = {}): AI {
  const client = opts.client ?? new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
  const models: Record<ModelTier, string> = { ...DEFAULT_MODELS, ...stripEmpty(opts.models) };
  const maxTokens = opts.maxTokens ?? 16000;

  async function create(input: {
    label: string;
    tier: ModelTier;
    system: string;
    messages: MessageParam[];
    tools?: Anthropic.Beta.BetaToolUnion[];
    effort: "low" | "medium" | "high";
  }): Promise<BetaMessage> {
    const model = models[input.tier];
    const fallback = FALLBACK_MODELS.test(model);
    const message = await client.beta.messages.create({
      model,
      max_tokens: maxTokens,
      system: input.system,
      messages: input.messages,
      ...(input.tools ? { tools: input.tools, tool_choice: { type: "auto" as const } } : {}),
      output_config: { effort: input.effort },
      ...(fallback ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
    });
    if (message.stop_reason === "refusal") {
      const details = message.stop_details as { category?: string | null; explanation?: string | null } | null | undefined;
      throw new Error(
        `Claude declined "${input.label}"${details?.category ? ` (${details.category})` : ""}${
          details?.explanation ? `: ${details.explanation}` : ""
        }`,
      );
    }
    return message;
  }

  return {
    mode: "anthropic",

    async json(req) {
      const { schema: inputSchema, wrapped } = toToolSchema(req.schema);
      const system = `${req.system}\n\nAnswer only by calling the ${SUBMIT_TOOL} tool exactly once with the complete result. Do not answer in plain text.`;
      const tools: Anthropic.Beta.BetaToolUnion[] = [
        {
          name: SUBMIT_TOOL,
          description: `Submit the result for "${req.label}". The input must match the schema exactly.`,
          input_schema: inputSchema as Anthropic.Beta.BetaTool.InputSchema,
        },
      ];
      const messages: MessageParam[] = [{ role: "user", content: userContent(req.prompt, req.images) }];
      let lastProblem = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        const message = await create({ label: req.label, tier: req.tier, system, messages, tools, effort: req.tier === "fast" ? "low" : "medium" });
        const uses = toolUses(message);
        const submit = uses.find((u) => u.name === SUBMIT_TOOL);
        if (submit) {
          const parsed = req.schema.safeParse(unwrapToolInput(submit.input, wrapped));
          if (parsed.success) return parsed.data;
          lastProblem = describeZodError(parsed.error);
        } else {
          lastProblem = "no submit_result tool call";
        }
        if (attempt === 1) break;
        messages.push({ role: "assistant", content: message.content as ContentBlockParam[] });
        if (uses.length > 0) {
          const results: ToolResultBlockParam[] = uses.map((u) => ({
            type: "tool_result",
            tool_use_id: u.id,
            is_error: true,
            content:
              u.name === SUBMIT_TOOL
                ? `Validation failed:\n${lastProblem}\nCall ${SUBMIT_TOOL} again with a corrected, complete result.`
                : `Unknown tool ${u.name}. Call ${SUBMIT_TOOL}.`,
          }));
          messages.push({ role: "user", content: results });
        } else {
          messages.push({ role: "user", content: `You did not call ${SUBMIT_TOOL}. Call it now with the complete result.` });
        }
      }
      throw new Error(`AI output for "${req.label}" failed validation after a repair attempt: ${lastProblem}`);
    },

    async text(req) {
      const message = await create({
        label: req.label,
        tier: req.tier,
        system: req.system,
        messages: [{ role: "user", content: userContent(req.prompt, req.images) }],
        effort: req.tier === "fast" ? "low" : "medium",
      });
      return textOf(message);
    },

    async runAgent(req) {
      const steps: AgentStep[] = [];
      const emit = (step: AgentStep) => {
        steps.push(step);
        req.onStep?.(step);
      };
      const toolDefs = req.tools.map((t) => ({ tool: t, ...toToolSchema(t.input) }));
      const tools: Anthropic.Beta.BetaToolUnion[] = toolDefs.map((d) => ({
        name: d.tool.name,
        description: d.tool.description,
        input_schema: d.schema as Anthropic.Beta.BetaTool.InputSchema,
      }));
      const messages: MessageParam[] = [{ role: "user", content: req.task }];
      let finalText = "";
      for (let turn = 0; turn < Math.max(1, req.maxSteps); turn++) {
        const message = await create({ label: req.label, tier: req.tier, system: req.system, messages, tools, effort: "medium" });
        const text = textOf(message);
        if (text) {
          emit({ index: steps.length, kind: "message", text });
          finalText = text;
        }
        const uses = toolUses(message);
        messages.push({ role: "assistant", content: message.content as ContentBlockParam[] });
        if (message.stop_reason === "pause_turn") continue;
        if (uses.length === 0 || message.stop_reason !== "tool_use") break;
        const results: ToolResultBlockParam[] = [];
        for (const use of uses) {
          const def = toolDefs.find((d) => d.tool.name === use.name);
          const input = unwrapToolInput(use.input, def?.wrapped ?? false);
          emit({ index: steps.length, kind: "tool_call", name: use.name, input });
          const { output, isError } = await runTool(def?.tool as AgentTool<unknown> | undefined, use.name, input);
          emit({ index: steps.length, kind: "tool_result", name: use.name, output });
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: isError || undefined, content: stringifyOutput(output) });
        }
        // All results for one assistant turn go back in a single user message.
        messages.push({ role: "user", content: results });
      }
      return { finalText, steps };
    },
  };
}

function stripEmpty(models?: Partial<Record<ModelTier, string>>): Partial<Record<ModelTier, string>> {
  const out: Partial<Record<ModelTier, string>> = {};
  for (const [k, v] of Object.entries(models ?? {})) {
    if (typeof v === "string" && v.trim() !== "") out[k as ModelTier] = v.trim();
  }
  return out;
}
