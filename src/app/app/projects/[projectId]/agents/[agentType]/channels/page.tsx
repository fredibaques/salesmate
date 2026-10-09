import { notFound } from "next/navigation";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getAgent, isProjectAgentType, listDataSources, listMcpServers } from "@/server/services/agents";
import { ToolsCard } from "../tools-card";

export default async function AgentChannelsPage({
  params,
}: PageProps<"/app/projects/[projectId]/agents/[agentType]/channels">) {
  const { projectId, agentType } = await params;
  if (!isProjectAgentType(agentType)) notFound();
  const tenant = await requireTenant();
  const db = getDb();
  const [agent, servers, sources] = await Promise.all([
    getAgent(db, tenant, projectId, agentType),
    listMcpServers(db, tenant),
    listDataSources(db, tenant),
  ]);
  if (!agent) notFound();
  // Accounts and channels are part of «Configuración»: here, only its tools.
  return (
    <ToolsCard
      projectId={projectId}
      agentType={agentType}
      tools={agent.config.tools}
      servers={servers}
      sources={sources}
      canEdit={tenant.role !== "member"}
    />
  );
}
