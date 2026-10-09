import { redirect } from "next/navigation";

/** The project's tables are listed in its summary now. */
export default async function ProjectTablesPage({
  params,
}: PageProps<"/app/projects/[projectId]/prospects">) {
  const { projectId } = await params;
  redirect(`/app/projects/${projectId}#tablas`);
}
