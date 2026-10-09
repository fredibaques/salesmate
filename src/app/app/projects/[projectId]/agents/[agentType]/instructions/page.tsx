import { redirect } from "next/navigation";

/** The instructions are part of the agent's «Configuración» tab now. */
export default async function AgentInstructionsPage({
  params,
}: PageProps<"/app/projects/[projectId]/agents/[agentType]/instructions">) {
  const { projectId, agentType } = await params;
  redirect(`/app/projects/${projectId}/agents/${agentType}`);
}
