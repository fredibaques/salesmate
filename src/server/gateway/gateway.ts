import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { audit } from "../audit";
import type { Db } from "../db/client";
import {
  actions,
  agentConfigs,
  approvals,
  complianceRules,
  identities,
  projectConnections,
  projects,
  type ActionContext,
  type ActionStatus,
  type AgentType,
  type Citation,
  type PolicyOutcome,
} from "../db/schema";
import { withTenant, type TenantContext, type Tx } from "../db/tenant";
import { getActionDefinition, type ActionDefinition } from "./definitions";
import { evaluatePolicies, POLICIES, type PolicyContext } from "./policies";

export type ActionRow = typeof actions.$inferSelect;

/** Performs the external effect of an approved action (connector call). */
export interface ActionExecutor {
  execute(input: { orgId: string; action: ActionRow }): Promise<Record<string, unknown>>;
}

export type GatewayDeps = {
  db: Db;
  executor: ActionExecutor;
  now?: () => Date;
  /** Best-effort side effects after a successful execution (e.g. log the email in its conversation). */
  afterExecute?: (input: { orgId: string; action: ActionRow }) => Promise<void>;
};

export type ProposeInput = {
  projectId: string;
  type: string;
  payload: Record<string, unknown>;
  context?: ActionContext;
  citations?: Citation[];
  reason?: string;
  agentType?: AgentType;
  /** The agent proposing it: its autonomy and limits apply (a project may have several of a kind). */
  agentConfigId?: string;
  runId?: string;
  /** Defaults to a hash of project, type, payload and run. */
  idempotencyKey?: string;
};

export type GatewayResult = {
  action: ActionRow;
  outcome: "executed" | "failed" | "pending_approval" | "deferred" | "blocked" | "approved" | "duplicate";
};

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly code: "unknown_action" | "invalid_payload" | "not_found" | "invalid_state",
    readonly details?: unknown,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Autonomy
// ---------------------------------------------------------------------------

/**
 * Effective autonomy: what the project allows for this agent and action,
 * capped by the action definition. A person acting directly is the approval.
 */
export async function resolveAutonomy(
  tx: Tx,
  input: {
    projectId: string;
    actorType: TenantContext["actorType"];
    agentType?: AgentType;
    agentConfigId?: string | null;
  },
  definition: ActionDefinition<Record<string, unknown>>,
): Promise<{ level: number; limits: { daily?: Record<string, number> } }> {
  if (input.actorType === "user") return { level: 3, limits: {} };
  if (!input.agentType && !input.agentConfigId)
    return { level: Math.min(1, definition.maxAutonomy), limits: {} };
  const config = await agentConfigOf(tx, input.projectId, input.agentConfigId, input.agentType);
  const configured =
    config?.autonomy.actions?.[definition.type] ??
    definition.defaultAutonomy ??
    config?.autonomy.default ??
    1;
  return {
    level: Math.max(0, Math.min(configured, definition.maxAutonomy)),
    limits: config?.limits ?? {},
  };
}

function decideStatus(
  results: PolicyOutcome[],
  level: number,
  actorType: TenantContext["actorType"],
): { status: ActionStatus; scheduledFor: Date | null } {
  if (results.some((r) => r.outcome === "block")) return { status: "blocked", scheduledFor: null };
  const needsHuman =
    level < 2 || (actorType !== "user" && results.some((r) => r.outcome === "require_approval"));
  if (needsHuman) return { status: "pending_approval", scheduledFor: null };
  const defers = results.filter((r) => r.outcome === "defer" && r.until).map((r) => new Date(r.until!));
  if (defers.length > 0) {
    return { status: "deferred", scheduledFor: new Date(Math.max(...defers.map((d) => d.getTime()))) };
  }
  return { status: "approved", scheduledFor: null };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function defaultIdempotencyKey(input: Pick<ProposeInput, "projectId" | "type" | "payload" | "runId">) {
  return createHash("sha256")
    .update(canonical([input.projectId, input.type, input.payload, input.runId ?? null]))
    .digest("hex");
}

function parsePayload(definition: ActionDefinition<Record<string, unknown>>, payload: unknown) {
  const parsed = definition.payloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new GatewayError("El contenido de la acción no es válido.", "invalid_payload", parsed.error.issues);
  }
  return parsed.data;
}

async function resolveConnectionId(
  tx: Tx,
  projectId: string,
  definition: ActionDefinition<Record<string, unknown>>,
  payload: Record<string, unknown>,
): Promise<string | null> {
  if (definition.connectionVia === "payload") {
    return typeof payload.connectionId === "string" ? payload.connectionId : null;
  }
  if (definition.connectionVia === "identity") {
    if (typeof payload.identityId !== "string") return null;
    const [identity] = await tx
      .select({ connectionId: identities.connectionId })
      .from(identities)
      .where(eq(identities.id, payload.identityId));
    return identity?.connectionId ?? null;
  }
  const [link] = await tx
    .select({ connectionId: projectConnections.connectionId })
    .from(projectConnections)
    .where(
      and(
        eq(projectConnections.projectId, projectId),
        sql`${definition.capability} = any(${projectConnections.capabilities})`,
      ),
    )
    .limit(1);
  return link?.connectionId ?? null;
}

async function buildPolicyContext(
  tx: Tx,
  tenant: TenantContext,
  input: {
    projectId: string;
    definition: ActionDefinition<Record<string, unknown>>;
    payload: Record<string, unknown>;
    context: ActionContext;
    citations: Citation[];
    connectionId: string | null;
    limits: { daily?: Record<string, number> };
    actorType: TenantContext["actorType"];
  },
  now: Date,
): Promise<PolicyContext> {
  const [project] = await tx.select().from(projects).where(eq(projects.id, input.projectId));
  if (!project) throw new GatewayError("Proyecto no encontrado.", "not_found");
  const rules = await tx
    .select({
      kind: complianceRules.kind,
      description: complianceRules.description,
      spec: complianceRules.spec,
    })
    .from(complianceRules)
    .where(and(eq(complianceRules.projectId, input.projectId), eq(complianceRules.active, true)));
  return {
    tx,
    orgId: tenant.orgId,
    project,
    definition: input.definition,
    payload: input.payload,
    context: input.context,
    targetKeys: input.definition.targetKeys(input.payload),
    citations: input.citations,
    actorType: input.actorType,
    connectionId: input.connectionId,
    rules,
    limits: input.limits,
    now,
  };
}

/** Send window and daily limits still apply to actions a person approved. */
async function deferralUntil(ctx: PolicyContext): Promise<{ until?: string; results: PolicyOutcome[] }> {
  const results = await evaluatePolicies(
    ctx,
    POLICIES.filter((p) => p.name === "send_window" || p.name === "daily_limit"),
  );
  const untils = results.filter((r) => r.outcome === "defer" && r.until).map((r) => r.until!);
  return { until: untils.sort().at(-1), results };
}

/** The agent by its id or, for actions recorded before agents had one, the first of its kind. */
async function agentConfigOf(
  tx: Tx,
  projectId: string,
  agentConfigId: string | null | undefined,
  agentType: AgentType | null | undefined,
) {
  if (!agentConfigId && !agentType) return null;
  const [config] = await tx
    .select()
    .from(agentConfigs)
    .where(
      and(
        eq(agentConfigs.projectId, projectId),
        agentConfigId ? eq(agentConfigs.id, agentConfigId) : eq(agentConfigs.agentType, agentType!),
      ),
    )
    .orderBy(asc(agentConfigs.addedAt))
    .limit(1);
  return config ?? null;
}

async function limitsFor(tx: Tx, action: Pick<ActionRow, "projectId" | "agentConfigId" | "agentType">) {
  const config = await agentConfigOf(tx, action.projectId, action.agentConfigId, action.agentType);
  return config?.limits ?? {};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Entry point for every external effect. Validates, applies policies and
 * autonomy, records the action and either executes it, defers it, queues it
 * for approval or blocks it. Idempotent per `idempotencyKey`.
 */
export async function proposeAction(
  deps: GatewayDeps,
  tenant: TenantContext,
  input: ProposeInput,
): Promise<GatewayResult> {
  const now = deps.now?.() ?? new Date();
  const definition = getActionDefinition(input.type);
  if (!definition) throw new GatewayError(`Tipo de acción desconocido: ${input.type}`, "unknown_action");
  const payload = parsePayload(definition, input.payload);
  const idempotencyKey = input.idempotencyKey ?? defaultIdempotencyKey({ ...input, payload });

  const recorded = await withTenant(deps.db, tenant, async (tx) => {
    const [existing] = await tx.select().from(actions).where(eq(actions.idempotencyKey, idempotencyKey));
    if (existing) return { action: existing, duplicate: true };

    const { level, limits } = await resolveAutonomy(
      tx,
      {
        projectId: input.projectId,
        actorType: tenant.actorType,
        agentType: input.agentType,
        agentConfigId: input.agentConfigId,
      },
      definition,
    );
    const connectionId = await resolveConnectionId(tx, input.projectId, definition, payload);
    const policyCtx = await buildPolicyContext(
      tx,
      tenant,
      {
        projectId: input.projectId,
        definition,
        payload,
        context: input.context ?? {},
        citations: input.citations ?? [],
        connectionId,
        limits,
        actorType: tenant.actorType,
      },
      now,
    );
    const results = await evaluatePolicies(policyCtx);
    const { status, scheduledFor } = decideStatus(results, level, tenant.actorType);

    const [action] = await tx
      .insert(actions)
      .values({
        orgId: tenant.orgId,
        projectId: input.projectId,
        runId: input.runId,
        agentType: input.agentType,
        agentConfigId: input.agentConfigId,
        actorType: tenant.actorType,
        actorId: tenant.actorId,
        type: definition.type,
        connectionId,
        payload,
        context: input.context ?? {},
        citations: input.citations ?? [],
        reason: input.reason,
        targetKeys: policyCtx.targetKeys,
        status,
        autonomyLevel: level,
        policyResults: results,
        idempotencyKey,
        scheduledFor,
        createdAt: now,
      })
      .returning();

    await audit(tx, tenant, {
      event: `action.${status}`,
      projectId: input.projectId,
      entityType: "action",
      entityId: action.id,
      data: {
        type: definition.type,
        summary: definition.summary(payload),
        autonomyLevel: level,
        policies: results.filter((r) => r.outcome !== "allow"),
      },
    });
    return { action, duplicate: false };
  });

  if (recorded.duplicate) return { action: recorded.action, outcome: "duplicate" };
  if (recorded.action.status === "approved") return executeAction(deps, tenant, recorded.action.id);
  return { action: recorded.action, outcome: recorded.action.status as GatewayResult["outcome"] };
}

/** A person approves (optionally editing the payload) or rejects a pending action. */
export async function decideAction(
  deps: GatewayDeps,
  tenant: TenantContext & { actorType: "user"; actorId: string },
  input: {
    actionId: string;
    decision: "approved" | "rejected";
    editedPayload?: Record<string, unknown>;
    reason?: string;
  },
): Promise<GatewayResult> {
  const now = deps.now?.() ?? new Date();
  const decided = await withTenant(deps.db, tenant, async (tx) => {
    const [action] = await tx.select().from(actions).where(eq(actions.id, input.actionId)).for("update");
    if (!action) throw new GatewayError("Acción no encontrada.", "not_found");
    if (action.status !== "pending_approval") {
      throw new GatewayError("La acción ya no está pendiente de aprobación.", "invalid_state");
    }
    const definition = getActionDefinition(action.type);
    if (!definition) throw new GatewayError(`Tipo de acción desconocido: ${action.type}`, "unknown_action");

    if (input.decision === "rejected") {
      await tx.insert(approvals).values({
        orgId: tenant.orgId,
        actionId: action.id,
        decision: "rejected",
        reason: input.reason,
        decidedBy: tenant.actorId,
      });
      const [updated] = await tx
        .update(actions)
        .set({ status: "rejected" })
        .where(eq(actions.id, action.id))
        .returning();
      await audit(tx, tenant, {
        event: "action.rejected",
        projectId: action.projectId,
        entityType: "action",
        entityId: action.id,
        data: { reason: input.reason },
      });
      return updated;
    }

    const edited = input.editedPayload !== undefined;
    const payload = edited ? parsePayload(definition, input.editedPayload) : action.payload;
    const connectionId = edited
      ? await resolveConnectionId(tx, action.projectId, definition, payload)
      : action.connectionId;
    const policyCtx = await buildPolicyContext(
      tx,
      tenant,
      {
        projectId: action.projectId,
        definition,
        payload,
        context: action.context,
        citations: action.citations,
        connectionId,
        limits: await limitsFor(tx, action),
        // The approver is a person, but the kill switch still protects agent actions.
        actorType: action.actorType,
      },
      now,
    );
    const rechecks = await evaluatePolicies(
      policyCtx,
      POLICIES.filter((p) => p.recheckOnApproval),
    );
    const blocked = rechecks.find((r) => r.outcome === "block");

    await tx.insert(approvals).values({
      orgId: tenant.orgId,
      actionId: action.id,
      decision: "approved",
      edited,
      editedPayload: edited ? payload : null,
      reason: input.reason,
      decidedBy: tenant.actorId,
    });

    const { until, results: window } = blocked
      ? { until: undefined, results: [] }
      : await deferralUntil(policyCtx);

    const status: ActionStatus = blocked ? "blocked" : until ? "deferred" : "approved";
    const [updated] = await tx
      .update(actions)
      .set({
        status,
        payload,
        connectionId,
        targetKeys: policyCtx.targetKeys,
        policyResults: [...action.policyResults, ...rechecks, ...window],
        scheduledFor: until ? new Date(until) : null,
      })
      .where(eq(actions.id, action.id))
      .returning();
    await audit(tx, tenant, {
      event: blocked ? "action.blocked" : "action.approved",
      projectId: action.projectId,
      entityType: "action",
      entityId: action.id,
      data: { edited, reason: blocked?.reason ?? input.reason, deferredUntil: until },
    });
    return updated;
  });

  if (decided.status === "approved") return executeAction(deps, tenant, decided.id);
  return { action: decided, outcome: decided.status as GatewayResult["outcome"] };
}

/**
 * Executes an approved action exactly once: the row is claimed with a
 * conditional update, so concurrent workers cannot both run it.
 */
export async function executeAction(
  deps: GatewayDeps,
  tenant: TenantContext,
  actionId: string,
): Promise<GatewayResult> {
  const claimed = await withTenant(deps.db, tenant, async (tx) => {
    const [action] = await tx
      .update(actions)
      .set({ status: "executing", attempts: sql`${actions.attempts} + 1` })
      .where(and(eq(actions.id, actionId), eq(actions.status, "approved")))
      .returning();
    if (!action) return null;
    const [project] = await tx.select().from(projects).where(eq(projects.id, action.projectId));
    const paused = project.status !== "active" || project.agentsPaused;
    if (paused && action.actorType !== "user") {
      const [back] = await tx
        .update(actions)
        .set({ status: "approved", attempts: sql`${actions.attempts} - 1` })
        .where(eq(actions.id, action.id))
        .returning();
      return { action: back, skipped: true };
    }
    await audit(tx, tenant, {
      event: "action.executing",
      projectId: action.projectId,
      entityType: "action",
      entityId: action.id,
    });
    return { action, skipped: false };
  });

  if (!claimed) {
    const current = await withTenant(deps.db, tenant, async (tx) => {
      const [row] = await tx.select().from(actions).where(eq(actions.id, actionId));
      return row;
    });
    if (!current) throw new GatewayError("Acción no encontrada.", "not_found");
    return { action: current, outcome: current.status === "succeeded" ? "executed" : "duplicate" };
  }
  if (claimed.skipped) return { action: claimed.action, outcome: "approved" };

  let result: Record<string, unknown> | null = null;
  let error: string | null = null;
  try {
    result = await deps.executor.execute({ orgId: tenant.orgId, action: claimed.action });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const finished = await withTenant(deps.db, tenant, async (tx) => {
    const [row] = await tx
      .update(actions)
      .set({
        status: error ? "failed" : "succeeded",
        result,
        error,
        executedAt: new Date(),
      })
      .where(eq(actions.id, actionId))
      .returning();
    await audit(tx, tenant, {
      event: error ? "action.failed" : "action.succeeded",
      projectId: row.projectId,
      entityType: "action",
      entityId: row.id,
      data: error ? { error } : { result },
    });
    return row;
  });
  if (!error && deps.afterExecute) {
    try {
      await deps.afterExecute({ orgId: tenant.orgId, action: finished });
    } catch (err) {
      console.error("afterExecute failed", err);
    }
  }
  return { action: finished, outcome: error ? "failed" : "executed" };
}

/** Cancels an action that has not run yet. */
export async function cancelAction(
  deps: Pick<GatewayDeps, "db">,
  tenant: TenantContext,
  actionId: string,
): Promise<ActionRow> {
  return withTenant(deps.db, tenant, async (tx) => {
    const [row] = await tx
      .update(actions)
      .set({ status: "cancelled" })
      .where(
        and(eq(actions.id, actionId), inArray(actions.status, ["pending_approval", "deferred", "approved"])),
      )
      .returning();
    if (!row) throw new GatewayError("La acción no se puede cancelar en su estado actual.", "invalid_state");
    await audit(tx, tenant, {
      event: "action.cancelled",
      projectId: row.projectId,
      entityType: "action",
      entityId: row.id,
    });
    return row;
  });
}

/**
 * Moves deferred actions whose time has come back through the gateway,
 * re-checking send window and daily limits. Called by the scheduler.
 */
export async function releaseDueActions(deps: GatewayDeps, tenant: TenantContext): Promise<GatewayResult[]> {
  const now = deps.now?.() ?? new Date();
  const ready = await withTenant(deps.db, tenant, async (tx) => {
    const due = await tx
      .select()
      .from(actions)
      .where(and(eq(actions.status, "deferred"), sql`${actions.scheduledFor} <= ${now.toISOString()}`))
      .for("update", { skipLocked: true });
    const releasable: string[] = [];
    for (const action of due) {
      const definition = getActionDefinition(action.type);
      if (!definition) continue;
      const ctx = await buildPolicyContext(
        tx,
        tenant,
        {
          projectId: action.projectId,
          definition,
          payload: action.payload,
          context: action.context,
          citations: action.citations,
          connectionId: action.connectionId,
          limits: await limitsFor(tx, action),
          actorType: action.actorType,
        },
        now,
      );
      const { until } = await deferralUntil(ctx);
      if (until) {
        await tx
          .update(actions)
          .set({ scheduledFor: new Date(until) })
          .where(eq(actions.id, action.id));
        continue;
      }
      await tx
        .update(actions)
        .set({ status: "approved", scheduledFor: null })
        .where(eq(actions.id, action.id));
      releasable.push(action.id);
    }
    return releasable;
  });
  const results: GatewayResult[] = [];
  for (const id of ready) results.push(await executeAction(deps, tenant, id));
  return results;
}
