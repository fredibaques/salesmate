import { describe, expect, it } from "vitest";
import { z } from "zod";
import { lastToolResults, scriptedLlm } from "../../../tests/helpers/fake-llm";
import { defineTool, runAgentLoop } from "./agent-loop";

const echo = defineTool({
  name: "echo",
  description: "Echo",
  input: z.object({ value: z.number() }),
  run: async ({ value }) => ({ doubled: value * 2 }),
});

describe("runAgentLoop", () => {
  it("stops before a new turn once its time budget is spent", async () => {
    let clock = 0;
    const { llm, requests } = scriptedLlm([
      { blocks: [{ type: "tool_use", name: "echo", input: { value: 1 } }] },
      { blocks: [{ type: "text", text: "no debería llegar" }] },
    ]);
    const result = await runAgentLoop({
      llm,
      system: "sys",
      messages: [{ role: "user", content: "hola" }],
      tools: [
        defineTool({
          ...echo,
          run: async (input) => {
            clock = 10_000; // the tool took long
            return echo.run(input);
          },
        }),
      ],
      deadline: 5_000,
      now: () => clock,
    });
    expect(result.status).toBe("deadline");
    expect(requests).toHaveLength(1);
    expect(result.steps.map((s) => s.type)).toEqual(["tool_call", "tool_result"]);
  });

  it("runs tools, sends results back and returns the final text", async () => {
    const { llm, requests } = scriptedLlm([
      {
        blocks: [
          { type: "text", text: "Voy a calcular." },
          { type: "tool_use", name: "echo", input: { value: 21 } },
        ],
      },
      (req) => {
        expect(lastToolResults(req)).toEqual([{ doubled: 42 }]);
        return { blocks: [{ type: "text", text: "El resultado es 42." }] };
      },
    ]);
    const result = await runAgentLoop({
      llm,
      system: "sys",
      messages: [{ role: "user", content: "hola" }],
      tools: [echo],
    });
    expect(result.status).toBe("completed");
    expect(result.finalText).toBe("El resultado es 42.");
    expect(result.steps.map((s) => s.type)).toEqual(["text", "tool_call", "tool_result", "text"]);
    expect(result.usage).toEqual({ input: 2000, output: 400, cacheRead: 0, cacheWrite: 0, webSearches: 0 });
    expect(result.costUsd).toBeCloseTo((2000 * 4 + 400 * 20) / 1e6);
    // Tool schema is derived from zod; effort and caching are set explicitly.
    expect(requests[0].tools?.[0]).toMatchObject({ name: "echo", input_schema: { type: "object" } });
    expect(requests[0].output_config).toEqual({ effort: "medium" });
    expect(requests[0].cache_control).toEqual({ type: "ephemeral" });
    // History is append-only: second request starts with the first one's messages.
    expect(requests[1].messages.slice(0, 1)).toEqual(requests[0].messages);
  });

  it("returns validation errors to the model instead of running the tool", async () => {
    const { llm } = scriptedLlm([
      { blocks: [{ type: "tool_use", name: "echo", input: { value: "no" } }] },
      (req) => {
        const [result] = lastToolResults(req) as { error: string }[];
        expect(result.error).toBe("Entrada no válida");
        const block = (req.messages.at(-1)!.content as { is_error?: boolean }[])[0];
        expect(block.is_error).toBe(true);
        return { blocks: [{ type: "text", text: "Perdón." }] };
      },
    ]);
    const result = await runAgentLoop({
      llm,
      system: "s",
      messages: [{ role: "user", content: "x" }],
      tools: [echo],
    });
    expect(result.status).toBe("completed");
  });

  it("stops on refusals and on the turn limit", async () => {
    const refused = await runAgentLoop({
      llm: scriptedLlm([{ blocks: [], stop: "refusal" }]).llm,
      system: "s",
      messages: [{ role: "user", content: "x" }],
      tools: [],
    });
    expect(refused.status).toBe("refused");

    const looping = scriptedLlm(
      Array.from({ length: 3 }, () => ({
        blocks: [{ type: "tool_use" as const, name: "echo", input: { value: 1 } }],
      })),
    );
    const limited = await runAgentLoop({
      llm: looping.llm,
      system: "s",
      messages: [{ role: "user", content: "x" }],
      tools: [echo],
      maxTurns: 3,
    });
    expect(limited.status).toBe("max_turns");
  });
});
