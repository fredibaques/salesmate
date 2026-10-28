import { getDb } from "../db/client";
import { gatewayDeps } from "../gateway/runtime";
import type { LlmClient } from "../llm/client";
import type { InboundDeps } from "./inbound";
import type { AgentRunDeps } from "./prospector";

/** Dependencies of an agent run with the organization's model client (see llm/org-ai.ts). */
export function inboundDeps(llm: LlmClient): InboundDeps {
  return { db: getDb(), llm, gateway: gatewayDeps() };
}

export function agentRunDeps(llm: LlmClient): AgentRunDeps {
  return { db: getDb(), llm, gateway: gatewayDeps() };
}
