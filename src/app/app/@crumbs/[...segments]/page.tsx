import { Breadcrumbs } from "@/components/breadcrumbs";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { conversationName, projectName, sourceName } from "@/server/services/names";
import { crumbsFor } from "../../crumbs";

/** Breadcrumbs slot: renders the trail for whatever page is open under /app. */
export default async function CrumbsSlot({ params }: { params: Promise<{ segments: string[] }> }) {
  const { segments } = await params;
  const tenant = await requireTenant();
  const db = getDb();
  const items = await crumbsFor(segments, {
    project: (id) => projectName(db, tenant, id).catch(() => null),
    source: (id) => sourceName(db, tenant, id).catch(() => null),
    conversation: (id) => conversationName(db, tenant, id).catch(() => null),
  });
  return <Breadcrumbs items={items} />;
}
