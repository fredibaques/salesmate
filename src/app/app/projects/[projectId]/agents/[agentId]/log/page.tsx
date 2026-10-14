import { redirect } from "next/navigation";

/** The old «Log» address: «Tareas», the agent's home. */
export default async function OldLogPage({
  params,
  searchParams,
}: PageProps<"/app/projects/[projectId]/agents/[agentId]/log">) {
  const { projectId, agentId } = await params;
  const q = new URLSearchParams(
    Object.entries(await searchParams).flatMap(([k, v]) =>
      typeof v === "string" ? [[k, v]] : (v ?? []).map((x) => [k, x]),
    ),
  ).toString();
  redirect(`/app/projects/${projectId}/agents/${agentId}${q ? `?${q}` : ""}`);
}
