import { redirect } from "next/navigation";

/** Approvals are part of the agent's configuration now (the «Configuración» modal on «Tareas»). */
export default async function AgentApprovalsPage({
  params,
}: PageProps<"/app/projects/[projectId]/agents/[agentId]/approvals">) {
  const { projectId, agentId } = await params;
  redirect(`/app/projects/${projectId}/agents/${agentId}?config=approvals`);
}
