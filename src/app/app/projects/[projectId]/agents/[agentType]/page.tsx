import { notFound } from "next/navigation";
import { isProjectAgentType } from "@/server/services/agents";
import { InboundSetup } from "./inbound-setup";
import { OutboundSetup } from "./outbound-setup";

/** «Configuración»: every agent's setup on one screen. Its sales process is the project's. */
export default async function AgentHomePage({
  params,
}: PageProps<"/app/projects/[projectId]/agents/[agentType]">) {
  const { projectId, agentType } = await params;
  if (!isProjectAgentType(agentType)) notFound();
  if (agentType === "outbound") return <OutboundSetup projectId={projectId} />;
  if (agentType === "inbound") return <InboundSetup projectId={projectId} />;
  notFound();
}
