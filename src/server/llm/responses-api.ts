import type {
  BetaMessage,
  BetaMessageParam,
  BetaToolUnion,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import OpenAI from "openai";
import type {
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseInputItem,
  ResponseOutputItem,
  Tool,
} from "openai/resources/responses/responses";
import { snapEffort } from "@/lib/ai-providers";
import type { LlmClient, LlmRequest } from "./client";

/**
 * OpenAI and Kimi through the Responses API (Kimi exposes a compatible one at
 * its own base URL). Agents speak the Messages shape, so this translates the
 * request and builds a Messages-shaped reply. Calls are stateless
 * (`store: false`): the raw output items ride along in the reply inside a
 * marker block and go back verbatim on the next turn, which keeps reasoning
 * and searches valid across the agent loop.
 */

export type ResponsesProvider = "openai" | "kimi";

export const BASE_URL: Record<ResponsesProvider, string | undefined> = {
  openai: undefined,
  kimi: "https://api.moonshot.ai/v1",
};

/** Prefix of the signature of the marker block that carries the raw output items. */
export const RAW_OUTPUT_MARK = "salesmate:responses:v1:";

type Created = Pick<
  Response,
  "id" | "model" | "output" | "status" | "usage" | "incomplete_details" | "error"
>;

export function responsesLlm(options: {
  provider: ResponsesProvider;
  apiKey: string;
  model: string;
  /** Tests: replaces the SDK call. */
  send?: (params: ResponseCreateParamsNonStreaming) => Promise<Created>;
}): LlmClient {
  const client = options.send
    ? undefined
    : new OpenAI({ apiKey: options.apiKey, baseURL: BASE_URL[options.provider], maxRetries: 2 });
  const send =
    options.send ?? ((params: ResponseCreateParamsNonStreaming) => client!.responses.create(params));
  return {
    provider: options.provider,
    model: options.model,
    async create(request) {
      const params = toResponsesParams(options.provider, request.model ?? options.model, request);
      const response = await send(params);
      if (response.status === "failed") {
        throw Object.assign(new Error(response.error?.message ?? "La respuesta ha fallado."), {
          code: response.error?.code,
        });
      }
      return toMessage(response);
    },
  };
}

export function toResponsesParams(
  provider: ResponsesProvider,
  model: string,
  request: LlmRequest,
): ResponseCreateParamsNonStreaming {
  const system =
    typeof request.system === "string"
      ? request.system
      : (request.system ?? []).map((b) => b.text).join("\n\n");
  const tools = toTools(request.tools ?? []);
  const effort = request.output_config?.effort ? snapEffort(model, request.output_config.effort) : undefined;
  const format = request.output_config?.format;
  return {
    model,
    ...(system ? { instructions: system } : {}),
    input: request.messages.flatMap(toInputItems),
    ...(tools.length ? { tools } : {}),
    max_output_tokens: request.max_tokens,
    ...(effort ? { reasoning: { effort } } : {}),
    ...(format?.type === "json_schema"
      ? { text: { format: { type: "json_schema", name: "output", schema: format.schema, strict: true } } }
      : {}),
    store: false,
    ...(provider === "openai" ? { include: ["reasoning.encrypted_content"] } : {}),
  };
}

function toTools(tools: BetaToolUnion[]): Tool[] {
  const out: Tool[] = [];
  let search = false;
  for (const tool of tools) {
    if ("input_schema" in tool) {
      out.push({
        type: "function",
        name: tool.name,
        description: tool.description ?? null,
        parameters: tool.input_schema as Record<string, unknown>,
        strict: false,
      });
    } else if (tool.type.startsWith("web_search") && !search) {
      // One search tool; it also opens pages, so web_fetch has no counterpart.
      search = true;
      out.push({ type: "web_search" });
    }
  }
  return out;
}

function toInputItems(message: BetaMessageParam): ResponseInputItem[] {
  if (typeof message.content === "string") {
    return [{ type: "message", role: message.role, content: message.content }];
  }
  if (message.role === "assistant") {
    const raw = message.content.find((b) => b.type === "thinking" && b.signature.startsWith(RAW_OUTPUT_MARK));
    if (raw && raw.type === "thinking") {
      return JSON.parse(raw.signature.slice(RAW_OUTPUT_MARK.length)) as ResponseInputItem[];
    }
  }
  const items: ResponseInputItem[] = [];
  let text: string[] = [];
  const flush = () => {
    if (text.length) items.push({ type: "message", role: message.role, content: text.join("\n\n") });
    text = [];
  };
  for (const block of message.content) {
    if (block.type === "text") text.push(block.text);
    else if (block.type === "tool_use") {
      flush();
      items.push({
        type: "function_call",
        call_id: block.id,
        name: block.name,
        arguments: JSON.stringify(block.input),
      });
    } else if (block.type === "tool_result") {
      flush();
      const output =
        typeof block.content === "string"
          ? block.content
          : (block.content ?? []).map((c) => (c.type === "text" ? c.text : "")).join("\n");
      items.push({ type: "function_call_output", call_id: block.tool_use_id, output });
    }
  }
  flush();
  return items;
}

export function toMessage(response: Created): BetaMessage {
  const content: Record<string, unknown>[] = [
    { type: "thinking", thinking: "", signature: RAW_OUTPUT_MARK + JSON.stringify(response.output) },
  ];
  let refused = false;
  let toolUse = false;
  let searches = 0;
  for (const item of response.output as ResponseOutputItem[]) {
    if (item.type === "message") {
      for (const part of item.content) {
        if (part.type === "output_text") content.push({ type: "text", text: part.text, citations: null });
        else if (part.type === "refusal") {
          refused = true;
          content.push({ type: "text", text: part.refusal, citations: null });
        }
      }
    } else if (item.type === "function_call") {
      toolUse = true;
      let input: unknown;
      try {
        input = JSON.parse(item.arguments || "{}");
      } catch {
        input = { _invalidJson: item.arguments };
      }
      content.push({ type: "tool_use", id: item.call_id, name: item.name, input });
    } else if (item.type === "web_search_call") {
      if (item.action?.type === "search") searches++;
      content.push({ type: "server_tool_use", id: item.id, name: "web_search", input: item.action ?? {} });
    }
  }

  const incomplete = response.status === "incomplete" ? response.incomplete_details?.reason : undefined;
  const stop =
    refused || incomplete === "content_filter"
      ? "refusal"
      : incomplete === "max_output_tokens"
        ? "max_tokens"
        : toolUse
          ? "tool_use"
          : "end_turn";

  const usage = response.usage;
  const cached = usage?.input_tokens_details?.cached_tokens ?? 0;
  const written = usage?.input_tokens_details?.cache_write_tokens ?? 0;
  return {
    id: response.id,
    type: "message",
    role: "assistant",
    model: response.model,
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: {
      input_tokens: Math.max(0, (usage?.input_tokens ?? 0) - cached - written),
      output_tokens: usage?.output_tokens ?? 0,
      cache_read_input_tokens: cached,
      cache_creation_input_tokens: written,
      server_tool_use: { web_search_requests: searches, web_fetch_requests: 0 },
    },
  } as unknown as BetaMessage;
}
