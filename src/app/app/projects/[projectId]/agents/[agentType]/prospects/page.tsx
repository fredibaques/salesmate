import { notFound, redirect } from "next/navigation";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { ensureAgentBase } from "@/server/prospects/bases";
import { getAgent } from "@/server/services/agents";

/** Prospects moved to the project's bases: old links open the base the agent fills. */
export default async function AgentProspectsPage({
  params,
}: PageProps<"/app/projects/[projectId]/agents/[agentType]/prospects">) {
  const { projectId, agentType } = await params;
  if (agentType !== "outbound") notFound();
  const tenant = await requireTenant();
  const db = getDb();
  const agent = await getAgent(db, tenant, projectId, "outbound");
  if (!agent) notFound();
  const base = await ensureAgentBase(db, tenant, agent.config.id);
  redirect(`/app/projects/${projectId}/prospects/${base.id}`);
}
