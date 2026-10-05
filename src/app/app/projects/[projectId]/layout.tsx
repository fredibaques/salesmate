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
          {project.agentsPaused ? <Badge tone="warning">Proyecto en pausa: ningún agente actúa</Badge> : null}
          <Button
            variant={project.agentsPaused ? "primary" : "ghost"}
            title="Freno de emergencia: detiene a la vez todos los agentes del proyecto"
          >
            {project.agentsPaused ? "Reanudar el proyecto" : "Pausar todo el proyecto"}
          </Button>
        </form>
      </div>
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
        <TabLink href={base} exact>
          Resumen
        </TabLink>
        <TabLink href={`${base}/agents`}>Agentes</TabLink>
        <TabLink href={`${base}/offer`}>Oferta y cliente</TabLink>
        <TabLink href={`${base}/knowledge`}>Conocimiento</TabLink>
        <TabLink href={`${base}/conversations`}>Conversaciones</TabLink>
        <TabLink href={`${base}/rules`}>Reglas</TabLink>
      </nav>
      {children}
    </>
  );
}
