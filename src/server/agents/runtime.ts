import { getDb } from "../db/client";
import { gatewayDeps } from "../gateway/runtime";
import { getLlm } from "../llm/client";
import type { InboundDeps } from "./inbound";
import type { AgentRunDeps } from "./prospector";

export function inboundDeps(): InboundDeps {
  return { db: getDb(), llm: getLlm(), gateway: gatewayDeps() };
}

export function agentRunDeps(): AgentRunDeps {
  return { db: getDb(), llm: getLlm(), gateway: gatewayDeps() };
}
