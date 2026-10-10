import { requireAgent } from "../require-agent";
import { notFound, redirect } from "next/navigation";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { ensureAgentBase } from "@/server/prospects/bases";

/** Prospects moved to the project's bases: old links open the base the agent fills. */
export default async function AgentProspectsPage({
  params,
}: PageProps<"/app/projects/[projectId]/agents/[agentId]/prospects">) {
  const { projectId, agentId } = await params;
  const tenant = await requireTenant();
  const db = getDb();
  const { agent } = await requireAgent(projectId, agentId);
  if (agent.config.agentType !== "prospecting") notFound();
  const base = await ensureAgentBase(db, tenant, agent.config.id);
  redirect(`/app/tables/${base.id}`);
}
