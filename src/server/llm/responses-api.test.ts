import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool, runAgentLoop } from "./agent-loop";
import { estimateCostUsd } from "./client";
import { classifyLlmError } from "./errors";
import { responsesLlm, toResponsesParams } from "./responses-api";

const double = defineTool({
  name: "double",
  description: "Doubles a number",
  input: z.object({ value: z.number() }),
  run: async ({ value }) => ({ doubled: value * 2 }),
});

const usage = (input: number, cached: number) => ({
  input_tokens: input,
  input_tokens_details: { cached_tokens: cached, cache_write_tokens: 0 },
  output_tokens: 100,
  output_tokens_details: { reasoning_tokens: 40 },
  total_tokens: input + 100,
});

describe("Responses API adapter (OpenAI, Kimi)", () => {
  it("runs the agent loop: tools, searches, reasoning replayed verbatim, usage and cost", async () => {
    const sent: ResponseCreateParamsNonStreaming[] = [];
    const llm = responsesLlm({
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-6.1-sol",
      send: async (params) => {
        sent.push(structuredClone(params));
        if (sent.length === 1) {
          return {
            id: "resp_1",
            model: "gpt-6.1-sol",
            status: "completed",
            error: null,
            incomplete_details: null,
            usage: usage(2000, 500),
            output: [
              { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "secret" },
              {
                type: "web_search_call",
                id: "ws_1",
                status: "completed",
                action: { type: "search", query: "concesionarios málaga" },
              },
              {
                type: "function_call",
                id: "fc_1",
                call_id: "call_1",
                name: "double",
                arguments: '{"value":21}',
                status: "completed",
              },
            ],
          } as never;
        }
        return {
          id: "resp_2",
          model: "gpt-6.1-sol",
          status: "completed",
          error: null,
          incomplete_details: null,
          usage: usage(2500, 2000),
          output: [
            {
              type: "message",
              id: "msg_2",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: "Son 42.", annotations: [] }],
            },
          ],
        } as never;
      },
    });

    const result = await runAgentLoop({
      llm,
      system: "Eres un asistente.",
      messages: [{ role: "user", content: "¿Cuánto es 21 por dos?" }],
      tools: [double],
      serverTools: [
        { type: "web_search_20260209", name: "web_search", max_uses: 5 },
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: 10 },
      ],
      effort: "medium",
    });

    expect(result.status).toBe("completed");
    expect(result.finalText).toBe("Son 42.");
    expect(result.steps.map((s) => s.type)).toEqual(["tool_call", "tool_call", "tool_result", "text"]);

    const first = sent[0];
    expect(first.instructions).toBe("Eres un asistente.");
    expect(first.store).toBe(false);
    expect(first.include).toEqual(["reasoning.encrypted_content"]);
    expect(first.reasoning).toEqual({ effort: "medium" });
    // One search tool (it also opens pages); web_fetch has no counterpart.
    expect(first.tools?.map((t) => t.type)).toEqual(["function", "web_search"]);
    expect(first.input).toEqual([{ type: "message", role: "user", content: "¿Cuánto es 21 por dos?" }]);

    // Second turn: the raw output goes back as is, then the tool result.
    const input = sent[1].input as { type: string }[];
    expect(input.map((i) => i.type)).toEqual([
      "message",
      "reasoning",
      "web_search_call",
      "function_call",
      "function_call_output",
    ]);
    expect(input[1]).toMatchObject({ encrypted_content: "secret" });
    expect(input[4]).toEqual({ type: "function_call_output", call_id: "call_1", output: '{"doubled":42}' });

    // Cached tokens are split out of the input like Claude reports them.
    expect(result.usage).toEqual({
      input: 1500 + 500,
      output: 200,
      cacheRead: 2500,
      cacheWrite: 0,
      webSearches: 1,
    });
    expect(result.costUsd).toBeCloseTo(estimateCostUsd("gpt-6.1-sol", result.usage), 10);
    expect(result.costUsd).toBeCloseTo((2000 * 2 + 200 * 10 + 2500 * 0.1) / 1e6 + 0.01, 10);
  });

  it("maps Kimi effort to the levels it accepts and asks for strict JSON", () => {
    const params = toResponsesParams("kimi", "kimi-k3", {
      max_tokens: 1000,
      messages: [{ role: "user", content: "hola" }],
      output_config: { effort: "medium", format: { type: "json_schema", schema: { type: "object" } } },
    });
    expect(params.reasoning).toEqual({ effort: "high" });
    expect(params.include).toBeUndefined();
    expect(params.text).toEqual({
      format: { type: "json_schema", name: "output", schema: { type: "object" }, strict: true },
    });
    // K2.6 takes no effort at all.
    const k26 = toResponsesParams("kimi", "kimi-k2.6", {
      max_tokens: 1000,
      messages: [{ role: "user", content: "hola" }],
      output_config: { effort: "high" },
    });
    expect(k26.reasoning).toBeUndefined();
  });

  it("reports truncation and refusals with the Messages stop reasons", async () => {
    const reply = (over: object) =>
      responsesLlm({
        provider: "kimi",
        apiKey: "sk-test",
        model: "kimi-k3",
        send: async () =>
          ({
            id: "r",
            model: "kimi-k3",
            status: "completed",
            error: null,
            incomplete_details: null,
            usage: usage(10, 0),
            output: [],
            ...over,
          }) as never,
      }).create({ max_tokens: 10, messages: [{ role: "user", content: "x" }] });
    expect(
      (await reply({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }))
        .stop_reason,
    ).toBe("max_tokens");
    expect(
      (
        await reply({
          output: [
            {
              type: "message",
              id: "m",
              role: "assistant",
              status: "completed",
              content: [{ type: "refusal", refusal: "No." }],
            },
          ],
        })
      ).stop_reason,
    ).toBe("refusal");
  });
});

describe("classifyLlmError", () => {
  it("tells account problems apart from passing ones", () => {
    expect(classifyLlmError("openai", { status: 401, message: "Incorrect API key" }).kind).toBe("auth");
    expect(
      classifyLlmError("openai", { status: 429, code: "insufficient_quota", message: "quota" }).kind,
    ).toBe("credit");
    expect(
      classifyLlmError("anthropic", {
        status: 400,
        message: "Your credit balance is too low to access the API",
      }).kind,
    ).toBe("credit");
    expect(
      classifyLlmError("kimi", { status: 404, message: "model not found" }, "kimi-k3").message,
    ).toContain("kimi-k3");
    expect(classifyLlmError("anthropic", { status: 429, message: "rate limited" }).kind).toBe("rate_limit");
    expect(classifyLlmError("anthropic", { status: 529, message: "overloaded" }).kind).toBe("unavailable");
  });
});
