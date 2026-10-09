import { after } from "next/server";
import { getDb } from "../db/client";
import { gatewayDeps } from "../gateway/runtime";
import type { LlmClient } from "../llm/client";
import { orgLlm } from "../llm/org-ai";
import { processAgentEvents, type RowsAddedTo } from "./events";
import { processPendingInbound, type InboundDeps } from "./inbound";
import type { AgentRunDeps } from "./prospector";

/** Dependencies of an agent run with the organization's model client (see llm/org-ai.ts). */
export function inboundDeps(llm: LlmClient): InboundDeps {
  return { db: getDb(), llm, gateway: gatewayDeps() };
}

export function agentRunDeps(llm: LlmClient): AgentRunDeps {
  return { db: getDb(), llm, gateway: gatewayDeps() };
}

/**
 * After answering, the agents that got new rows of a table work on them:
 * the prospecting agent completes them, the inbound agent attends the people.
 * Whatever can't run now (no AI, a busy agent) the scheduler picks up later.
 */
export function workOnAddedRows(tenant: { orgId: string }, added: RowsAddedTo) {
  if (!added.prospecting && !added.inboundProject) return false;
  after(async () => {
    try {
      const llm = await orgLlm(getDb(), tenant);
      if (!llm) return;
      if (added.prospecting) await processAgentEvents(agentRunDeps(llm), tenant, added.prospecting);
      if (added.inboundProject) {
        await processPendingInbound(inboundDeps(llm), tenant.orgId, 5, added.inboundProject);
      }
    } catch (err) {
      console.error("new-row run failed", err);
    }
  });
  return true;
}
