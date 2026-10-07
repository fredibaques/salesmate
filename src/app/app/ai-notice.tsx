import { cache } from "react";
import { LinkButton, Notice } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getOrgAi } from "@/server/llm/org-ai";

export const AI_SETTINGS_HREF = "/app/ai";
/** The guided connection (provider, how to get the key, paste it). */
export const AI_CONNECT_HREF = "/app/ai/connect";

/** The organization's AI connection, once per request. */
export const currentAi = cache(async () => getOrgAi(getDb(), await requireTenant()));

/**
 * Says why a feature can't use the AI: the organization hasn't connected it,
 * or the provider rejected the key, the balance or the model. Nothing when
 * it works.
 */
export async function AiNotice({ feature }: { feature: string }) {
  const ai = await currentAi();
  if (ai?.status === "active") return null;
  return (
    <Notice
      tone={ai ? "danger" : "warning"}
      action={
        <LinkButton href={ai ? AI_SETTINGS_HREF : AI_CONNECT_HREF} size="sm">
          {ai ? "Revisar" : "Conectar IA"}
        </LinkButton>
      }
    >
      {ai
        ? `${ai.lastError ?? "Tu proveedor de IA ha rechazado la última petición."} ${feature} no funcionará hasta que lo resuelvas.`
        : `${feature} necesita IA. Conecta tu cuenta de Anthropic, OpenAI o Kimi en Configuración → IA.`}
    </Notice>
  );
}
