import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaMessage,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { AI_PROVIDER_INFO, findModel, snapEffort, type AiProvider } from "@/lib/ai-providers";

/**
 * Thin seam over the model providers so agents can be tested with a scripted
 * model. Requests and responses use the shape of Anthropic's Messages API;
 * other providers translate to and from it (responses-api.ts). Claude goes
 * through the beta endpoint to opt into server-side fallbacks: if a safety
 * classifier declines a request, the API retries it on Anthropic's
 * recommended fallback model in the same call.
 */
export type LlmRequest = Omit<MessageCreateParamsNonStreaming, "model" | "betas" | "fallbacks"> & {
  model?: string;
};

export interface LlmClient {
  readonly provider: AiProvider;
  readonly model: string;
  create(request: LlmRequest): Promise<BetaMessage>;
}

export class LlmNotConfiguredError extends Error {
  constructor() {
    super("La IA no está conectada: añade la clave de tu proveedor en Configuración → IA.");
  }
}

export function anthropicLlm(options: { apiKey: string; model: string }): LlmClient {
  const client = new Anthropic({ apiKey: options.apiKey });
  return {
    provider: "anthropic",
    model: options.model,
    create: (request) => {
      const model = request.model ?? options.model;
      const effort = request.output_config?.effort;
      const snapped = effort ? snapEffort(model, effort) : undefined;
      return client.beta.messages.create({
        ...request,
        output_config: request.output_config ? { ...request.output_config, effort: snapped } : undefined,
        model,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
    },
  };
}

/** USD for the tokens of a run. Unknown models count as zero. */
export function estimateCostUsd(
  model: string,
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; webSearches?: number },
): number {
  const found = findModel(model);
  if (!found) return 0;
  const p = found.price;
  return (
    (usage.input * p.input +
      usage.output * p.output +
      usage.cacheRead * p.cacheRead +
      usage.cacheWrite * p.cacheWrite) /
      1_000_000 +
    (usage.webSearches ?? 0) * AI_PROVIDER_INFO[found.provider].webSearchUsd
  );
}
