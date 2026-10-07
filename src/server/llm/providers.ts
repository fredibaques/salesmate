import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { AI_PROVIDER_INFO, type AiProvider } from "@/lib/ai-providers";
import { anthropicLlm, type LlmClient } from "./client";
import { classifyLlmError, LlmProviderError } from "./errors";
import { BASE_URL, responsesLlm } from "./responses-api";

export function createLlm(options: { provider: AiProvider; apiKey: string; model: string }): LlmClient {
  return options.provider === "anthropic"
    ? anthropicLlm(options)
    : responsesLlm({ provider: options.provider, apiKey: options.apiKey, model: options.model });
}

/**
 * Checks a key without spending: lists the account's models (free on the
 * three providers) and makes sure the chosen one is among them.
 */
export async function verifyApiKey(provider: AiProvider, apiKey: string, model: string): Promise<void> {
  let ids: string[];
  try {
    if (provider === "anthropic") {
      const client = new Anthropic({ apiKey, maxRetries: 1 });
      ids = [];
      for await (const m of client.models.list({ limit: 100 })) ids.push(m.id);
    } else {
      const client = new OpenAI({ apiKey, baseURL: BASE_URL[provider], maxRetries: 1 });
      ids = [];
      for await (const m of client.models.list()) ids.push(m.id);
    }
  } catch (err) {
    throw classifyLlmError(provider, err, model);
  }
  if (ids.length && !ids.some((id) => id === model || id.startsWith(`${model}-`))) {
    throw new LlmProviderError(
      "model",
      provider,
      `Tu cuenta de ${AI_PROVIDER_INFO[provider].label} no tiene acceso al modelo ${model}.`,
    );
  }
}
