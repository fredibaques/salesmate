/**
 * The AI providers an organization can connect with its own API key, their
 * models and prices. Shared by the settings screen and the server (cost
 * estimates), so it holds data only.
 */

export const AI_PROVIDERS = ["anthropic", "openai", "kimi"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type AiModel = {
  id: string;
  label: string;
  /** Shown under the option: what it is good for. */
  hint: string;
  /** USD per million tokens. */
  price: { input: number; output: number; cacheRead: number; cacheWrite: number };
  /** Reasoning levels the model accepts; requests snap to the nearest one. None: not sent. */
  efforts?: readonly Effort[];
  /** The provider's cheap model, for simple bulk work (reading a company's pages). */
  small?: boolean;
};

export type AiProviderInfo = {
  id: AiProvider;
  label: string;
  /** Where people create a key. */
  keysUrl: string;
  keyPlaceholder: string;
  /** USD per web search the model runs. */
  webSearchUsd: number;
  models: readonly AiModel[];
};

const ALL_EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

export const AI_PROVIDER_INFO: Record<AiProvider, AiProviderInfo> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude)",
    keysUrl: "https://platform.claude.com/settings/keys",
    keyPlaceholder: "sk-ant-…",
    webSearchUsd: 0.01,
    models: [
      {
        id: "claude-opus-5-5",
        label: "Claude Opus 5.5",
        hint: "El más capaz. Recomendado para los agentes.",
        price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
        efforts: ALL_EFFORTS,
      },
      {
        id: "claude-sonnet-5-5",
        label: "Claude Sonnet 5.5",
        hint: "Muy bueno y más barato.",
        price: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
        efforts: ALL_EFFORTS,
      },
      {
        id: "claude-haiku-4-5",
        label: "Claude Haiku 4.5",
        hint: "Rápido y económico, para tareas sencillas.",
        price: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
        small: true,
      },
    ],
  },
  openai: {
    id: "openai",
    label: "OpenAI (GPT)",
    keysUrl: "https://platform.openai.com/api-keys",
    keyPlaceholder: "sk-…",
    webSearchUsd: 0.01,
    models: [
      {
        id: "gpt-6.1-sol",
        label: "GPT-6.1 Sol",
        hint: "Equilibrado. Recomendado para los agentes.",
        price: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
        efforts: ALL_EFFORTS,
      },
      {
        id: "gpt-6-astra",
        label: "GPT-6 Astra",
        hint: "El más capaz, y el más caro.",
        price: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
        efforts: ALL_EFFORTS,
      },
      {
        id: "gpt-6-luna",
        label: "GPT-6 Luna",
        hint: "Muy económico, para tareas sencillas.",
        price: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
        efforts: ALL_EFFORTS,
        small: true,
      },
    ],
  },
  kimi: {
    id: "kimi",
    label: "Kimi (Moonshot AI)",
    keysUrl: "https://platform.kimi.ai/console/api-keys",
    keyPlaceholder: "sk-…",
    webSearchUsd: 0.005,
    models: [
      {
        id: "kimi-k3",
        label: "Kimi K3",
        hint: "El más capaz de Kimi. Recomendado para los agentes.",
        price: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3 },
        efforts: ["low", "high", "max"],
      },
      {
        id: "kimi-k2.6",
        label: "Kimi K2.6",
        hint: "Más económico.",
        price: { input: 0.95, output: 4, cacheRead: 0.16, cacheWrite: 0.95 },
        small: true,
      },
    ],
  },
};

export function isAiProvider(value: unknown): value is AiProvider {
  return typeof value === "string" && (AI_PROVIDERS as readonly string[]).includes(value);
}

export function defaultModel(provider: AiProvider): string {
  return AI_PROVIDER_INFO[provider].models[0].id;
}

/** The provider's cheap model (its last one if none is marked). */
export function smallModel(provider: AiProvider): string {
  const models = AI_PROVIDER_INFO[provider].models;
  return (models.find((m) => m.small) ?? models[models.length - 1]).id;
}

export function findModel(model: string): (AiModel & { provider: AiProvider }) | undefined {
  for (const provider of AI_PROVIDERS) {
    // Dated snapshots (claude-haiku-4-5-20251001) price like their alias.
    const found = AI_PROVIDER_INFO[provider].models.find(
      (m) => model === m.id || model.startsWith(`${m.id}-`),
    );
    if (found) return { ...found, provider };
  }
  return undefined;
}

/** The closest level the model accepts, never below the one asked for when possible. */
export function snapEffort(model: string, effort: Effort): Effort | undefined {
  const levels = findModel(model)?.efforts;
  if (!levels?.length) return undefined;
  if (levels.includes(effort)) return effort;
  const order = ALL_EFFORTS.indexOf(effort);
  return levels.find((l) => ALL_EFFORTS.indexOf(l) > order) ?? levels.at(-1);
}
