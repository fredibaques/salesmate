import { notFound } from "next/navigation";
import { TabLink } from "@/components/nav-link";
import { Badge, Button } from "@/components/ui";
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
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          {project.description ? (
            <p className="mt-1 max-w-3xl text-sm text-muted">{project.description}</p>
          ) : null}
        </div>
        <form
          action={toggleAgents.bind(null, project.id, !project.agentsPaused)}
          className="flex items-center gap-3"
        >
          {project.agentsPaused ? (
            <Badge tone="warning">Agentes pausados</Badge>
          ) : (
            <Badge tone="success">Agentes activos</Badge>
          )}
          <Button variant={project.agentsPaused ? "primary" : "danger"}>
            {project.agentsPaused ? "Reanudar agentes" : "Pausar todos los agentes"}
          </Button>
        </form>
      </div>
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
        <TabLink href={base} exact>
          General
        </TabLink>
        <TabLink href={`${base}/conversations`}>Conversaciones</TabLink>
        <TabLink href={`${base}/playbooks`}>Playbooks</TabLink>
        <TabLink href={`${base}/channels`}>Canales</TabLink>
        <TabLink href={`${base}/knowledge`}>Conocimiento</TabLink>
        <TabLink href={`${base}/meetings`}>Reuniones</TabLink>
        <TabLink href={`${base}/rules`}>Agentes y reglas</TabLink>
      </nav>
      {children}
    </>
  );
}
