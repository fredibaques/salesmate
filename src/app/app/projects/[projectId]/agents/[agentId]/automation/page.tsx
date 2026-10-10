import { redirect } from "next/navigation";

/** Old address: the prospecting agent's automation is now part of its configuration. */
export default async function AgentAutomationPage({
  params,
}: PageProps<"/app/projects/[projectId]/agents/[agentId]/automation">) {
  const { projectId, agentId } = await params;
  redirect(`/app/projects/${projectId}/agents/${agentId}`);
}
