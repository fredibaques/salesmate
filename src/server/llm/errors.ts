import { AI_PROVIDER_INFO, type AiProvider } from "@/lib/ai-providers";

/**
 * What went wrong when calling the provider, in terms people can act on.
 * `auth`, `credit` and `model` are problems with the organization's account:
 * they mark its AI connection so the settings screen and the notices show it.
 */
export type LlmErrorKind = "auth" | "credit" | "model" | "rate_limit" | "unavailable" | "other";

export class LlmProviderError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    readonly provider: AiProvider,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
  }
}

type ApiErrorLike = {
  status?: number;
  message?: string;
  code?: string | null;
  type?: string;
  error?: { type?: string; code?: string; message?: string; error?: { type?: string; message?: string } };
};

export function classifyLlmError(provider: AiProvider, err: unknown, model?: string): LlmProviderError {
  if (err instanceof LlmProviderError) return err;
  const e = (typeof err === "object" && err !== null ? err : {}) as ApiErrorLike;
  const status = typeof e.status === "number" ? e.status : undefined;
  const detail = e.message ?? String(err);
  const codes = [e.code, e.type, e.error?.type, e.error?.code, e.error?.error?.type]
    .filter(Boolean)
    .join(" ");
  const text = `${codes} ${detail}`.toLowerCase();
  const name = AI_PROVIDER_INFO[provider].label;

  if (status === 401 || status === 403 || /invalid.?api.?key|authentication/.test(text)) {
    return new LlmProviderError(
      "auth",
      provider,
      `La clave de ${name} no es válida o se ha revocado.`,
      detail,
    );
  }
  if (
    status === 402 ||
    /credit balance|insufficient_quota|quota|insufficient.?balance|billing|suspended/.test(text)
  ) {
    return new LlmProviderError(
      "credit",
      provider,
      `Tu cuenta de ${name} no tiene saldo o ha superado su límite de gasto.`,
      detail,
    );
  }
  if (
    status === 404 ||
    ((status === 400 || status === undefined) &&
      /model.*(not.?found|does not exist|not available|no access)/.test(text))
  ) {
    return new LlmProviderError(
      "model",
      provider,
      `El modelo ${model ?? ""} no está disponible para tu cuenta de ${name}.`.replace("  ", " "),
      detail,
    );
  }
  if (status === 429) {
    return new LlmProviderError(
      "rate_limit",
      provider,
      `${name} está limitando las peticiones. Prueba en un momento.`,
      detail,
    );
  }
  if (status === undefined || status >= 500) {
    return new LlmProviderError(
      "unavailable",
      provider,
      `${name} no responde ahora mismo. Prueba en un momento.`,
      detail,
    );
  }
  return new LlmProviderError("other", provider, `${name} ha rechazado la petición: ${detail}`, detail);
}
