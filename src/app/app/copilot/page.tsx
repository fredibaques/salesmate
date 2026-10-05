import { Bot, FolderKanban } from "lucide-react";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { isLlmConfigured } from "@/server/llm/client";
import { listProjects } from "@/server/services/projects";
import { NewProjectButton } from "../projects/new-project";
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
        <Card>
          <EmptyState
            icon={<Bot />}
            title="La IA no está configurada"
            description="Añade ANTHROPIC_API_KEY en las variables de entorno del servidor y vuelve a desplegar para usar el copiloto."
          />
        </Card>
      ) : projects.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FolderKanban />}
            title="Crea un proyecto primero"
            description="El copiloto responde con la información de cada proyecto: sus documentos, tarifas y conversaciones."
            action={<NewProjectButton />}
          />
        </Card>
      ) : (
        <CopilotChat projects={projects.map((p) => ({ id: p.id, name: p.name }))} />
      )}
    </>
  );
}
