import { PageHeader } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listProjectAgents } from "@/server/services/agents";
import { AgentCards } from "./agent-cards";

export const metadata = { title: "Agentes" };

export default async function AgentsPage({ params }: PageProps<"/app/projects/[projectId]/agents">) {
  const { projectId } = await params;
  const tenant = await requireTenant();
  const agents = await listProjectAgents(getDb(), tenant, projectId);

  return (
    <>
      <PageHeader
        level="section"
        title="Agentes"
        description="Cada agente se encarga de una parte de la venta y sigue su propio proceso. Lo que comparten (qué vendes, a quién, objeciones, tono) está en «Oferta y cliente»."
      />
      <AgentCards projectId={projectId} agents={agents} />
    </>
  );
}
