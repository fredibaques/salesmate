import { EmptyState, PageHeader } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { isLlmConfigured } from "@/server/llm/client";
import { listProjects } from "@/server/services/projects";
import { CopilotChat } from "./chat";

export const metadata = { title: "Copiloto" };

export default async function CopilotPage() {
  const tenant = await requireTenant();
  const projects = await listProjects(getDb(), tenant);
  return (
    <>
      <PageHeader
        title="Copiloto"
        description="Tu asistente comercial sobre la información de cada proyecto."
      />
      {!isLlmConfigured() ? (
        <EmptyState>Configura ANTHROPIC_API_KEY para usar el copiloto.</EmptyState>
      ) : projects.length === 0 ? (
        <EmptyState>Crea un proyecto primero.</EmptyState>
      ) : (
        <CopilotChat projects={projects.map((p) => ({ id: p.id, name: p.name }))} />
      )}
    </>
  );
}
