import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaMessage,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { env } from "../env";

/**
 * Thin seam over the Anthropic SDK so agents can be tested with a scripted
 * model. Production uses Claude through the beta Messages endpoint to opt
 * into server-side fallbacks: if a safety classifier declines a request, the
 * API retries it on Anthropic's recommended fallback model in the same call.
 */
export type LlmRequest = Omit<MessageCreateParamsNonStreaming, "model" | "betas" | "fallbacks"> & {
  model?: string;
};

export interface LlmClient {
  readonly model: string;
  create(request: LlmRequest): Promise<BetaMessage>;
}

export const DEFAULT_MODEL = "claude-opus-5-5";

export class LlmNotConfiguredError extends Error {
  constructor() {
    super("La IA no está configurada: falta ANTHROPIC_API_KEY.");
  }
}

export function anthropicLlm(options: { apiKey?: string; model?: string } = {}): LlmClient {
  const apiKey = options.apiKey ?? env().ANTHROPIC_API_KEY;
  if (!apiKey) throw new LlmNotConfiguredError();
  const client = new Anthropic({ apiKey });
  const model = options.model ?? env().ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  return {
    model,
    create: (request) =>
      client.beta.messages.create({
        ...request,
        model: request.model ?? model,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      }),
  };
}

let shared: LlmClient | undefined;

/** Process-wide client; throws LlmNotConfiguredError when there is no key. */
export function getLlm(): LlmClient {
  shared ??= anthropicLlm();
  return shared;
}

export function isLlmConfigured(): boolean {
  return Boolean(env().ANTHROPIC_API_KEY);
}

/** USD per million tokens (input, output, cache read). Unknown models count as zero. */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1 },
};

export function estimateCostUsd(
  model: string,
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number },
): number {
  const p = PRICES[model];
  if (!p) return 0;
  return (
    (usage.input * p.input + usage.output * p.output + usage.cacheRead * p.cacheRead + usage.cacheWrite * p.input * 1.25) /
    1_000_000
  );
}
