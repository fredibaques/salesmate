import { notFound } from "next/navigation";
import { TabLink, Tabs } from "@/components/nav-link";
import { FolderKanban, OctagonPause, Play } from "lucide-react";
import { SectionChrome } from "@/components/section-chrome";
import { Badge, Button, Notice, PageHeader } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getProject } from "@/server/services/projects";
import { toggleAgents } from "./actions";

export default async function ProjectLayout({ children, params }: LayoutProps<"/app/projects/[projectId]">) {
  const { projectId } = await params;
  const tenant = await requireTenant();
  const project = await getProject(getDb(), tenant, projectId).catch(() => null);
  if (!project) notFound();
  const base = `/app/projects/${project.id}`;

  return (
    <>
      <SectionChrome
        fallback={
          project.agentsPaused ? (
            <div className="mb-5">
              <Notice tone="warning">
                El proyecto está en pausa: ningún agente actúa hasta que lo reanudes.
              </Notice>
            </div>
          ) : null
        }
      >
        <PageHeader
          className="mb-4"
          icon={<FolderKanban />}
          title={project.name}
          badge={project.agentsPaused ? <Badge tone="warning">En pausa: ningún agente actúa</Badge> : null}
          actions={
            <form action={toggleAgents.bind(null, project.id, !project.agentsPaused)}>
              <Button
                variant={project.agentsPaused ? "primary" : "ghost"}
                title="Freno de emergencia: detiene a la vez todos los agentes del proyecto"
              >
                {project.agentsPaused ? <Play className="size-4" /> : <OctagonPause className="size-4" />}
                {project.agentsPaused ? "Reanudar el proyecto" : "Pausar todo el proyecto"}
              </Button>
            </form>
          }
        />
        <Tabs>
          <TabLink href={base} exact also={[`${base}/agents`]}>
            Resumen
          </TabLink>
          <TabLink href={`${base}/prospects`}>Tablas</TabLink>
          <TabLink href={`${base}/knowledge`}>Conocimiento</TabLink>
          <TabLink href={`${base}/conversations`}>Conversaciones</TabLink>
          <TabLink href={`${base}/meetings`}>Reuniones</TabLink>
          <TabLink href={`${base}/settings`} also={[`${base}/rules`]}>
            Ajustes
          </TabLink>
        </Tabs>
      </SectionChrome>
      {children}
    </>
  );
}
