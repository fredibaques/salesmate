import { redirect } from "next/navigation";

/** Tables live at /app/tables/<id>: older links (from a project) go there. */
export default async function OldTablePage({
  params,
  searchParams,
}: PageProps<"/app/projects/[projectId]/prospects/[baseId]">) {
  const { baseId } = await params;
  const query = new URLSearchParams(
    Object.entries(await searchParams).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])),
  ).toString();
  redirect(`/app/tables/${baseId}${query ? `?${query}` : ""}`);
}
