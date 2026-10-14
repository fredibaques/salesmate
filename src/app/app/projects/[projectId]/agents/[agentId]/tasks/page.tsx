import { redirect } from "next/navigation";

/** «Tareas» is the agent's home now. */
export default async function AgentTasksPage({
  params,
  searchParams,
}: PageProps<"/app/projects/[projectId]/agents/[agentId]/tasks">) {
  const { projectId, agentId } = await params;
  const q = new URLSearchParams(
    Object.entries(await searchParams).flatMap(([k, v]) =>
      typeof v === "string" ? [[k, v]] : (v ?? []).map((x) => [k, x]),
    ),
  ).toString();
  redirect(`/app/projects/${projectId}/agents/${agentId}${q ? `?${q}` : ""}`);
}
