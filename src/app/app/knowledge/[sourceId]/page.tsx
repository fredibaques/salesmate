import { notFound, redirect } from "next/navigation";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getSourceDetail } from "@/server/knowledge/service";
import { SourceDetail } from "../source-detail";

export default async function AccountSourcePage({ params }: PageProps<"/app/knowledge/[sourceId]">) {
  const { sourceId } = await params;
  const tenant = await requireTenant();
  const detail = await getSourceDetail(getDb(), tenant, sourceId).catch(() => null);
  if (!detail) notFound();
  // A project's knowledge opens under its project.
  if (detail.source.projectId) redirect(`/app/projects/${detail.source.projectId}/knowledge/${sourceId}`);
  return <SourceDetail tenant={tenant} detail={detail} />;
}
