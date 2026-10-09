import { redirect } from "next/navigation";

/** Adding an agent happens in a modal of the project's summary: older links open it there. */
export default async function NewAgentPage({
  params,
}: PageProps<"/app/projects/[projectId]/agents/new/[agentType]">) {
  const { projectId, agentType } = await params;
  redirect(`/app/projects/${projectId}?agente=${agentType}`);
}
