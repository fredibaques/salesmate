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

export type CostLine = { key: string; label: string; detail: string; usd: number };

/**
 * What a run cost, item by item: the model's input, output and cache
 * tokens, the web searches, and anything else billed to it (e.g. the first
 * emails drafted after a prospecting run), so the lines add up to `totalUsd`.
 */
export function costBreakdown(
  model: string,
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; webSearches: number },
  totalUsd: number,
): CostLine[] {
  const found = findModel(model);
  const n = (v: number) => v.toLocaleString("es-ES");
  const lines: CostLine[] = [];
  if (found) {
    const p = found.price;
    lines.push(
      {
        key: "input",
        label: "Entrada",
        detail: `${n(usage.input)} tokens`,
        usd: (usage.input * p.input) / 1e6,
      },
      {
        key: "output",
        label: "Salida",
        detail: `${n(usage.output)} tokens`,
        usd: (usage.output * p.output) / 1e6,
      },
      {
        key: "cache",
        label: "Caché",
        detail: `${n(usage.cacheRead)} leídos, ${n(usage.cacheWrite)} escritos`,
        usd: (usage.cacheRead * p.cacheRead + usage.cacheWrite * p.cacheWrite) / 1e6,
      },
      {
        key: "search",
        label: "Búsquedas web",
        detail: `${n(usage.webSearches)} búsquedas`,
        usd: usage.webSearches * AI_PROVIDER_INFO[found.provider].webSearchUsd,
      },
    );
  }
  const rest = totalUsd - lines.reduce((sum, l) => sum + l.usd, 0);
  if (rest > 0.0005) {
    lines.push({
      key: "other",
      label: found ? "Otros" : "Modelo",
      detail: found
        ? "Completado de filas con el modelo pequeño, búsquedas de Serper, borradores de emails y otros pasos"
        : `Precios de ${model} no conocidos`,
      usd: rest,
    });
  }
  return lines.filter((l) => l.usd > 0 || l.key === "input");
}

/**
 * The same client answering with another model of its provider (an agent's
 * own choice). A model of another provider, or unknown, is ignored: the
 * organization may have changed provider since it was chosen.
 */
export function withModel(llm: LlmClient, model: string | undefined | null): LlmClient {
  if (!model || model === llm.model) return llm;
  if (!AI_PROVIDER_INFO[llm.provider].models.some((m) => m.id === model)) return llm;
  return {
    provider: llm.provider,
    model,
    create: (request) => llm.create({ ...request, model: request.model ?? model }),
  };
}
