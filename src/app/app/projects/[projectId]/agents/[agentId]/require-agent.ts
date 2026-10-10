import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getAgent, isProjectAgentType, listProjectAgents } from "@/server/services/agents";

/**
 * The agent of an agent page, once per request (layout and page share it).
 * Old addresses named the kind (…/agents/inbound): they open the first
 * agent of that kind. Anything else is not found.
 */
export const requireAgent = cache(async (projectId: string, agentId: string) => {
  const tenant = await requireTenant();
  const agent = await getAgent(getDb(), tenant, projectId, agentId);
  if (agent) return { tenant, agent };
  if (isProjectAgentType(agentId)) {
    const first = (await listProjectAgents(getDb(), tenant, projectId)).find(
      (a) => a.config.agentType === agentId,
    );
    if (first) redirect(`/app/projects/${projectId}/agents/${first.config.id}`);
  }
  notFound();
});
