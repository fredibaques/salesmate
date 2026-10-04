import { getDb } from "../db/client";
import { gatewayDeps } from "../gateway/runtime";
import { getLlm } from "../llm/client";
import type { InboundDeps } from "./inbound";

export function inboundDeps(): InboundDeps {
  return { db: getDb(), llm: getLlm(), gateway: gatewayDeps() };
}
