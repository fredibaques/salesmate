import type {
  BetaContentBlock,
  BetaMessageParam,
  BetaTextBlockParam,
  BetaTool,
  BetaToolResultBlockParam,
  BetaToolUnion,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import type { AgentRunStep } from "../db/schema";
import { estimateCostUsd, type LlmClient } from "./client";

/** A tool the agent can call. Inputs are validated with zod before running. */
export type AgentTool = {
  name: string;
  description: string;
  input: z.ZodType;
  /** JSON Schema sent to the model instead of the one derived from `input` (external tools). */
  jsonSchema?: Record<string, unknown>;
  run(input: unknown): Promise<unknown>;
};

export function defineTool<S extends z.ZodType>(tool: {
  name: string;
  description: string;
  input: S;
  run(input: z.infer<S>): Promise<unknown>;
}): AgentTool {
  return tool as AgentTool;
}

export type AgentLoopResult = {
  status: "completed" | "refused" | "max_turns" | "truncated";
  finalText: string;
  steps: AgentRunStep[];
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; webSearches: number };
  costUsd: number;
  model: string;
};

/** Web search is billed per request on top of tokens (USD 10 per 1,000). */
const WEB_SEARCH_USD = 0.01;

/** Server tools run on Anthropic's side (web search, web fetch): no `run`, just the definition. */
export type ServerTool = Extract<BetaToolUnion, { type: `web_search_${string}` | `web_fetch_${string}` }>;

function toApiTool(tool: AgentTool): BetaTool {
  const schema = tool.jsonSchema
    ? { ...tool.jsonSchema }
    : (z.toJSONSchema(tool.input, { io: "input", unrepresentable: "any" }) as Record<string, unknown>);
  delete schema.$schema;
  return {
    name: tool.name,
    description: tool.description,
    input_schema: { ...schema, type: "object" } as BetaTool["input_schema"],
  };
}

function truncateForTrace(value: unknown, max = 4000): unknown {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined) return value;
  return text.length > max ? `${text.slice(0, max)}…` : value;
}

/**
 * Manual agentic loop (append-only history, so thinking blocks stay valid).
 * Tools never touch the outside world directly: anything with an external
 * effect goes through the Action Gateway inside the tool implementation.
 */
export async function runAgentLoop(input: {
  llm: LlmClient;
  system: string;
  messages: BetaMessageParam[];
  tools: AgentTool[];
  serverTools?: ServerTool[];
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTurns?: number;
  maxTokens?: number;
}): Promise<AgentLoopResult> {
  const messages = [...input.messages];
  const steps: AgentRunStep[] = [];
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, webSearches: 0 };
  const byName = new Map(input.tools.map((t) => [t.name, t]));
  const apiTools: BetaToolUnion[] = [...input.tools.map(toApiTool), ...(input.serverTools ?? [])];
  const cost = () => estimateCostUsd(model, usage) + usage.webSearches * WEB_SEARCH_USD;
  const system: BetaTextBlockParam[] = [{ type: "text", text: input.system }];
  let model = input.llm.model;
  let finalText = "";

  for (let turn = 0; turn < (input.maxTurns ?? 12); turn++) {
    const response = await input.llm.create({
      max_tokens: input.maxTokens ?? 16_000,
      system,
      tools: apiTools,
      messages,
      output_config: { effort: input.effort ?? "medium" },
      // Caches tools + system + history prefix across turns of the loop.
      cache_control: { type: "ephemeral" },
    });
    model = response.model;
    usage.input += response.usage.input_tokens;
    usage.output += response.usage.output_tokens;
    usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;
    usage.cacheWrite += response.usage.cache_creation_input_tokens ?? 0;
    usage.webSearches += response.usage.server_tool_use?.web_search_requests ?? 0;

    // Searches and fetches Claude ran on the server side, for the trace.
    for (const block of response.content) {
      if (block.type === "server_tool_use")
        steps.push({ type: "tool_call", name: block.name, input: block.input });
    }

    const text = response.content
      .filter((b): b is Extract<BetaContentBlock, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (text) {
      steps.push({ type: "text", text });
      finalText = text;
    }

    const result = (status: AgentLoopResult["status"]): AgentLoopResult => ({
      status,
      finalText,
      steps,
      usage,
      costUsd: cost(),
      model,
    });

    if (response.stop_reason === "refusal") return result("refused");
    if (response.stop_reason === "max_tokens") return result("truncated");
    messages.push({ role: "assistant", content: response.content });
    if (response.stop_reason === "pause_turn") continue;
    if (response.stop_reason !== "tool_use") return result("completed");

    const calls = response.content.filter(
      (b): b is Extract<BetaContentBlock, { type: "tool_use" }> => b.type === "tool_use",
    );
    const results: BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      steps.push({ type: "tool_call", name: call.name, input: call.input });
      const tool = byName.get(call.name);
      let output: unknown;
      let isError = false;
      if (!tool) {
        output = { error: `Herramienta desconocida: ${call.name}` };
        isError = true;
      } else {
        const parsed = tool.input.safeParse(call.input);
        if (!parsed.success) {
          output = { error: "Entrada no válida", issues: parsed.error.issues.slice(0, 5) };
          isError = true;
        } else {
          try {
            output = await tool.run(parsed.data);
          } catch (err) {
            output = { error: err instanceof Error ? err.message : String(err) };
            isError = true;
          }
        }
      }
      steps.push({ type: "tool_result", name: call.name, output: truncateForTrace(output), isError });
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: typeof output === "string" ? output : JSON.stringify(output),
        ...(isError ? { is_error: true } : {}),
      });
    }
    // All results of one turn go back in a single user message.
    messages.push({ role: "user", content: results });
  }

  return {
    status: "max_turns",
    finalText,
    steps,
    usage,
    costUsd: cost(),
    model,
  };
}
