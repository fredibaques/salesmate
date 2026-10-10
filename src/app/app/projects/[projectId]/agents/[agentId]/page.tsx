import { notFound } from "next/navigation";
import { requireAgent } from "./require-agent";
import { InboundSetup } from "./inbound-setup";
import { OutboundSetup } from "./outbound-setup";

/** «Configuración»: every agent's setup on one screen. Its sales process is the project's. */
export default async function AgentHomePage({
  params,
}: PageProps<"/app/projects/[projectId]/agents/[agentId]">) {
  const { projectId, agentId } = await params;
  const { agent } = await requireAgent(projectId, agentId);
  if (agent?.config.agentType === "outbound")
    return <OutboundSetup projectId={projectId} agentId={agentId} />;
  if (agent?.config.agentType === "inbound") return <InboundSetup projectId={projectId} agentId={agentId} />;
  notFound();
}
