import { Sparkles } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { isAiProvider } from "@/lib/ai-providers";
import { redirect } from "next/navigation";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getOrgAi } from "@/server/llm/org-ai";
import { connectAiFromWizard } from "../actions";
import { ConnectAiWizard } from "../ai-form";

export const metadata = { title: "Conectar IA" };

/** Guided connection: which provider, how to get its key, then paste it. */
export default async function ConnectAiPage({ searchParams }: PageProps<"/app/ai/connect">) {
  const tenant = await requireTenant();
  // Only admins connect the organization's AI; others see its state.
  if (tenant.role !== "owner" && tenant.role !== "admin") redirect("/app/ai");
  const [{ provider }, ai] = await Promise.all([searchParams, getOrgAi(getDb(), tenant)]);
  return (
    <>
      <PageHeader
        icon={<Sparkles />}
        title={ai ? "Cambiar la cuenta de IA" : "Conectar tu IA"}
        tip="Los agentes, Copilot y las propuestas con IA usan la cuenta de tu organización. Necesitas una clave de API de Anthropic, OpenAI o Kimi."
      />
      <ConnectAiWizard
        action={connectAiFromWizard}
        initialProvider={isAiProvider(provider) ? provider : undefined}
        current={ai ? { provider: ai.provider, model: ai.model, keyHint: ai.keyHint } : undefined}
      />
    </>
  );
}
