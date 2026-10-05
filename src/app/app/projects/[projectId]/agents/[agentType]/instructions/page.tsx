import { notFound } from "next/navigation";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getAgent, isProjectAgentType } from "@/server/services/agents";
import { InstructionsCard } from "../instructions-card";

export default async function AgentInstructionsPage({
  params,
}: PageProps<"/app/projects/[projectId]/agents/[agentType]/instructions">) {
  const { projectId, agentType } = await params;
  if (!isProjectAgentType(agentType)) notFound();
  const tenant = await requireTenant();
  const agent = await getAgent(getDb(), tenant, projectId, agentType);
  if (!agent) notFound();
  return (
    <div className="max-w-3xl">
      <InstructionsCard projectId={projectId} agentType={agentType} config={agent.config} />
    </div>
  );
}
