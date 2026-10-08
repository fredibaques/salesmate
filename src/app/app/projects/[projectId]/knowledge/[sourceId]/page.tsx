import { notFound, redirect } from "next/navigation";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getSourceDetail } from "@/server/knowledge/service";
import { SourceDetail } from "../../../../knowledge/source-detail";

export default async function SourcePage({
  params,
}: PageProps<"/app/projects/[projectId]/knowledge/[sourceId]">) {
  const { projectId, sourceId } = await params;
  const tenant = await requireTenant();
  const detail = await getSourceDetail(getDb(), tenant, sourceId).catch(() => null);
  if (!detail) notFound();
  // Knowledge of the whole account, or of another project, opens where it lives.
  if (detail.source.projectId !== projectId) {
    redirect(
      detail.source.projectId
        ? `/app/projects/${detail.source.projectId}/knowledge/${sourceId}`
        : `/app/knowledge/${sourceId}`,
    );
  }
  return <SourceDetail tenant={tenant} detail={detail} />;
}
