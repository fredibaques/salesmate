import { requireAgent } from "../require-agent";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db/client";
import { listDataSources, listMcpServers } from "@/server/services/agents";
import { ToolsCard } from "../tools-card";

export default async function AgentChannelsPage({
  params,
}: PageProps<"/app/projects/[projectId]/agents/[agentId]/channels">) {
  const { projectId, agentId } = await params;
  const { tenant, agent } = await requireAgent(projectId, agentId);
  const db = getDb();
  const [servers, sources] = await Promise.all([listMcpServers(db, tenant), listDataSources(db, tenant)]);
  if (!agent) notFound();
  // Accounts and channels are part of «Configuración»: here, only its tools.
  return (
    <ToolsCard
      projectId={projectId}
      agentId={agentId}
      tools={agent.config.tools}
      servers={servers}
      sources={sources}
      canEdit={tenant.role !== "member"}
    />
  );
}
