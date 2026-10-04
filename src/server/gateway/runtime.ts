import { recordActionInConversation } from "../agents/conversations";
import { ConnectorExecutor } from "../connectors/executor";
import { getDb } from "../db/client";
import type { GatewayDeps } from "./gateway";

/** Production wiring: real database and connector-backed execution. */
export function gatewayDeps(): GatewayDeps {
  const db = getDb();
  return {
    db,
    executor: new ConnectorExecutor({ db }),
    afterExecute: ({ orgId, action }) => recordActionInConversation(db, orgId, action),
  };
}
