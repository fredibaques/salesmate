import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { LlmClient, LlmRequest } from "@/server/llm/client";

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; name: string; input: Record<string, unknown> };

export type ScriptedTurn = {
  blocks: Block[];
  stop?: BetaMessage["stop_reason"];
};

/**
 * Plays back a fixed list of model turns and records every request, so agent
 * behaviour (tools called, prompts sent, state written) can be tested
 * deterministically without the API. A turn can be a function to read the
 * previous tool results.
 */
export function scriptedLlm(turns: (ScriptedTurn | ((req: LlmRequest) => ScriptedTurn))[]) {
  const requests: LlmRequest[] = [];
  let i = 0;
  const llm: LlmClient = {
    model: "claude-opus-5-5",
    async create(request) {
      requests.push(structuredClone(request));
      const next = turns[i++];
      if (!next) throw new Error(`Scripted LLM ran out of turns (call ${i})`);
      const turn = typeof next === "function" ? next(request) : next;
      const content = turn.blocks.map((b, n) =>
        b.type === "text"
          ? { type: "text" as const, text: b.text, citations: null }
          : { type: "tool_use" as const, id: `toolu_${i}_${n}`, name: b.name, input: b.input },
      );
      return {
        id: `msg_${i}`,
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content,
        stop_reason: turn.stop ?? (turn.blocks.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn"),
        stop_sequence: null,
        usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      } as unknown as BetaMessage;
    },
  };
  return { llm, requests };
}

/** Tool results sent back in the last request, keyed by tool_use_id order. */
export function lastToolResults(req: LlmRequest): unknown[] {
  const last = req.messages.at(-1);
  if (!last || !Array.isArray(last.content)) return [];
  return last.content
    .filter((b) => b.type === "tool_result")
    .map((b) => {
      const content = (b as { content?: unknown }).content;
      return typeof content === "string" ? JSON.parse(content) : content;
    });
}
