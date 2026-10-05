import { redirect } from "next/navigation";

/** The project's home is its agents. */
export default async function AgentsPage({ params }: PageProps<"/app/projects/[projectId]/agents">) {
  const { projectId } = await params;
  redirect(`/app/projects/${projectId}`);
}
