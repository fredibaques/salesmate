import { sql } from "drizzle-orm";

/** A run that hasn't finished in this long is stale (closeStaleRuns closes it), not working. */
const WORKING_WINDOW = "2 hours";

/**
 * Whether the agent of the `agent_configs` row in the query is running right
 * now (it has a run started recently that hasn't finished), as a column.
 * The outer columns are written qualified: drizzle leaves a column's table
 * out inside a select, which would compare the run with itself.
 */
export const workingSql = sql<boolean>`exists (
  select 1 from agent_runs r
  where r.project_id = "agent_configs"."project_id"
    and r.agent_type = "agent_configs"."agent_type"
    and r.status = 'running'
    and r.started_at > now() - interval '${sql.raw(WORKING_WINDOW)}'
)`;
