import { Bot, FolderKanban } from "lucide-react";
import { Card, EmptyState, LinkButton } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { AI_SETTINGS_HREF, AiNotice, currentAi } from "../../ai-notice";
import { listProjects } from "@/server/services/projects";
import { NewProjectButton } from "../../projects/new-project";
import { CopilotChat } from "./chat";

export const metadata = { title: "Copilot" };

export default async function CopilotPage() {
  const tenant = await requireTenant();
  const [projects, ai] = await Promise.all([listProjects(getDb(), tenant), currentAi()]);
  return (
    <>
      {!ai ? (
        <Card>
          <EmptyState
            icon={<Bot />}
            title="Conecta tu IA"
            description="Copilot usa la cuenta de IA de tu organización: Anthropic, OpenAI o Kimi."
            action={
              <LinkButton href={AI_SETTINGS_HREF} variant="primary">
                Conectar IA
              </LinkButton>
            }
          />
        </Card>
      ) : projects.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FolderKanban />}
            title="Crea un proyecto primero"
            description="Copilot responde con la información de cada proyecto: sus documentos, tarifas y conversaciones."
            action={<NewProjectButton />}
          />
        </Card>
      ) : (
        <>
          <div className="mb-4 empty:hidden">
            <AiNotice feature="Copilot" />
          </div>
          <CopilotChat projects={projects.map((p) => ({ id: p.id, name: p.name }))} />
        </>
      )}
    </>
  );
}
