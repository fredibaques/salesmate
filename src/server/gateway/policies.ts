import { TZDate } from "@date-fns/tz";
import { and, arrayOverlaps, count, eq, gte, inArray, isNull, ne, or } from "drizzle-orm";
import {
  actions,
  connections,
  knowledgeSources,
  projectIdentities,
  projects,
  suppressions,
  type ActionContext,
  type Citation,
  type LimitsConfig,
  type PolicyOutcome,
} from "../db/schema";
import type { Tx } from "../db/tenant";
import type { ActionDefinition } from "./definitions";
import { personKeys, suppressionLookupKeys } from "./targets";
import { knowledgeOf } from "../knowledge/service";

type ProjectRow = typeof projects.$inferSelect;
type RuleRow = {
  kind: "human_only" | "mandatory_notice" | "channel_restriction" | "retention";
  description: string;
  spec: Record<string, unknown>;
};

export type PolicyContext = {
  tx: Tx;
  orgId: string;
  project: ProjectRow;
  definition: ActionDefinition<Record<string, unknown>>;
  payload: Record<string, unknown>;
  context: ActionContext;
  targetKeys: string[];
  citations: Citation[];
  actorType: "agent" | "user" | "system" | "mcp_client";
  connectionId: string | null;
  rules: RuleRow[];
  limits: LimitsConfig;
  now: Date;
};

export type Policy = {
  name: string;
  /** Re-evaluated when a person approves (possibly after editing the payload). */
  recheckOnApproval: boolean;
  check(ctx: PolicyContext): Promise<Omit<PolicyOutcome, "policy">> | Omit<PolicyOutcome, "policy">;
};

const allow = { outcome: "allow" } as const;

const DEFAULT_SEND_WINDOW: [string, string] = ["08:00", "20:00"];
const DEFAULT_SEND_DAYS = [1, 2, 3, 4, 5];
const DEFAULT_COOLDOWN_DAYS = 30;
const FIGURE_PATTERN = /(\d[\d.,]*\s?(€|eur\b|euros?\b|%|\$|usd\b))|((€|\$)\s?\d)/i;

function rulesFor(ctx: PolicyContext, kind: RuleRow["kind"]) {
  return ctx.rules.filter(
    (r) =>
      r.kind === kind &&
      Array.isArray(r.spec.actionTypes) &&
      (r.spec.actionTypes as string[]).includes(ctx.definition.type),
  );
}

export const projectState: Policy = {
  name: "project_state",
  recheckOnApproval: true,
  check(ctx) {
    if (ctx.project.status === "archived") {
      return { outcome: "block", reason: "El proyecto está archivado." };
    }
    const paused = ctx.project.status === "paused" || ctx.project.agentsPaused;
    if (paused && ctx.actorType !== "user") {
      return { outcome: "block", reason: "Los agentes de este proyecto están pausados." };
    }
    return allow;
  },
};

export const identityAssignment: Policy = {
  name: "identity_assignment",
  recheckOnApproval: true,
  async check(ctx) {
    const identityId = ctx.payload.identityId;
    if (ctx.definition.connectionVia !== "identity" || typeof identityId !== "string") return allow;
    const [row] = await ctx.tx
      .select({ id: projectIdentities.identityId })
      .from(projectIdentities)
      .where(
        and(eq(projectIdentities.projectId, ctx.project.id), eq(projectIdentities.identityId, identityId)),
      );
    return row
      ? allow
      : { outcome: "block", reason: "La identidad indicada no está asignada a este proyecto." };
  },
};

export const connectionAvailable: Policy = {
  name: "connection_available",
  recheckOnApproval: true,
  async check(ctx) {
    if (!ctx.connectionId) {
      return {
        outcome: "block",
        reason: `No hay ninguna conexión del proyecto que ofrezca «${ctx.definition.capability}».`,
      };
    }
    const [conn] = await ctx.tx
      .select({ status: connections.status })
      .from(connections)
      .where(eq(connections.id, ctx.connectionId));
    if (!conn || conn.status !== "active") {
      return { outcome: "block", reason: "La conexión necesaria no está activa." };
    }
    return allow;
  },
};

export const suppressionList: Policy = {
  name: "suppression",
  recheckOnApproval: true,
  async check(ctx) {
    if (ctx.targetKeys.length === 0) return allow;
    const lookups = suppressionLookupKeys(ctx.targetKeys);
    const [hit] = await ctx.tx
      .select({ type: suppressions.type, value: suppressions.value, reason: suppressions.reason })
      .from(suppressions)
      .where(
        and(
          or(isNull(suppressions.projectId), eq(suppressions.projectId, ctx.project.id)),
          or(...lookups.map((l) => and(eq(suppressions.type, l.type), eq(suppressions.value, l.value)))),
        ),
      )
      .limit(1);
    return hit
      ? {
          outcome: "block",
          reason: `Destinatario excluido (${hit.type}: ${hit.value})${hit.reason ? `: ${hit.reason}` : ""}.`,
        }
      : allow;
  },
};

export const crossProjectCooldown: Policy = {
  name: "cross_project_cooldown",
  recheckOnApproval: false,
  async check(ctx) {
    const people = personKeys(ctx.targetKeys);
    if (!ctx.definition.outbound || people.length === 0) return allow;
    const days = ctx.project.settings.crossProjectCooldownDays ?? DEFAULT_COOLDOWN_DAYS;
    const since = new Date(ctx.now.getTime() - days * 86_400_000);
    const [hit] = await ctx.tx
      .select({ projectName: projects.name })
      .from(actions)
      .innerJoin(projects, eq(projects.id, actions.projectId))
      .where(
        and(
          ne(actions.projectId, ctx.project.id),
          inArray(actions.status, ["approved", "executing", "succeeded"]),
          gte(actions.createdAt, since),
          arrayOverlaps(actions.targetKeys, people),
        ),
      )
      .limit(1);
    return hit
      ? {
          outcome: "require_approval",
          reason: `El proyecto «${hit.projectName}» ya contactó con este destinatario en los últimos ${days} días.`,
        }
      : allow;
  },
};

export const dailyLimit: Policy = {
  name: "daily_limit",
  recheckOnApproval: false,
  async check(ctx) {
    const limit = ctx.limits.daily?.[ctx.definition.type];
    if (limit === undefined) return allow;
    const since = new Date(ctx.now.getTime() - 86_400_000);
    const [{ value }] = await ctx.tx
      .select({ value: count() })
      .from(actions)
      .where(
        and(
          eq(actions.projectId, ctx.project.id),
          eq(actions.type, ctx.definition.type),
          inArray(actions.status, ["approved", "executing", "succeeded"]),
          gte(actions.createdAt, since),
        ),
      );
    if (value < limit) return allow;
    return {
      outcome: "defer",
      reason: `Límite diario alcanzado (${limit} × ${ctx.definition.type}).`,
      until: new Date(ctx.now.getTime() + 86_400_000).toISOString(),
    };
  },
};

/** Returns the next instant inside the window, or null when `now` is already inside. */
export function nextSendWindowStart(
  now: Date,
  timezone: string,
  window: [string, string],
  days: number[],
): Date | null {
  const [startH, startM] = window[0].split(":").map(Number);
  const [endH, endM] = window[1].split(":").map(Number);
  const local = new TZDate(now.getTime(), timezone);
  const minutes = local.getHours() * 60 + local.getMinutes();
  const isoDay = ((local.getDay() + 6) % 7) + 1;
  const inDay = days.includes(isoDay);
  if (inDay && minutes >= startH * 60 + startM && minutes < endH * 60 + endM) return null;

  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new TZDate(
      local.getFullYear(),
      local.getMonth(),
      local.getDate() + offset,
      startH,
      startM,
      0,
      timezone,
    );
    const candidateDay = ((candidate.getDay() + 6) % 7) + 1;
    if (candidate.getTime() > now.getTime() && days.includes(candidateDay)) {
      return new Date(candidate.getTime());
    }
  }
  return null;
}

export const sendWindow: Policy = {
  name: "send_window",
  recheckOnApproval: false,
  check(ctx) {
    if (!ctx.definition.outbound) return allow;
    const next = nextSendWindowStart(
      ctx.now,
      ctx.project.timezone,
      ctx.project.settings.sendWindow ?? DEFAULT_SEND_WINDOW,
      ctx.project.settings.sendDays ?? DEFAULT_SEND_DAYS,
    );
    return next
      ? { outcome: "defer", reason: "Fuera del horario de envío del proyecto.", until: next.toISOString() }
      : allow;
  },
};

export const humanOnlyRules: Policy = {
  name: "compliance_human_only",
  recheckOnApproval: false,
  check(ctx) {
    const [rule] = rulesFor(ctx, "human_only");
    return rule
      ? { outcome: "require_approval", reason: `Reservado a personas: ${rule.description}` }
      : allow;
  },
};

export const channelRestrictionRules: Policy = {
  name: "compliance_channel_restriction",
  recheckOnApproval: true,
  check(ctx) {
    const customerType = ctx.context.customerType;
    if (!customerType) return allow;
    const rule = rulesFor(ctx, "channel_restriction").find((r) =>
      ((r.spec.customerTypes as string[] | undefined) ?? []).includes(customerType),
    );
    return rule ? { outcome: "block", reason: `Canal restringido: ${rule.description}` } : allow;
  },
};

export const mandatoryNoticeRules: Policy = {
  name: "compliance_mandatory_notice",
  recheckOnApproval: true,
  check(ctx) {
    const text = ctx.definition.textOf(ctx.payload).toLowerCase();
    const missing = rulesFor(ctx, "mandatory_notice").find(
      (r) => typeof r.spec.text === "string" && !text.includes((r.spec.text as string).toLowerCase()),
    );
    return missing
      ? { outcome: "require_approval", reason: `Falta el aviso obligatorio: ${missing.description}` }
      : allow;
  },
};

export const backedFigures: Policy = {
  name: "backed_figures",
  recheckOnApproval: false,
  async check(ctx) {
    if (!ctx.definition.outbound) return allow;
    if (!FIGURE_PATTERN.test(ctx.definition.textOf(ctx.payload))) return allow;
    const sourceIds = [...new Set(ctx.citations.map((c) => c.sourceId))];
    if (sourceIds.length > 0) {
      const [backing] = await ctx.tx
        .select({ id: knowledgeSources.id })
        .from(knowledgeSources)
        .where(and(inArray(knowledgeSources.id, sourceIds), knowledgeOf(ctx.project.id)))
        .limit(1);
      if (backing) return allow;
    }
    return {
      outcome: "require_approval",
      reason: "El mensaje contiene cifras que no salen del conocimiento del proyecto.",
    };
  },
};

export const POLICIES: Policy[] = [
  projectState,
  identityAssignment,
  connectionAvailable,
  suppressionList,
  channelRestrictionRules,
  crossProjectCooldown,
  dailyLimit,
  sendWindow,
  humanOnlyRules,
  mandatoryNoticeRules,
  backedFigures,
];

export async function evaluatePolicies(
  ctx: PolicyContext,
  policies: Policy[] = POLICIES,
): Promise<PolicyOutcome[]> {
  const results: PolicyOutcome[] = [];
  for (const policy of policies) {
    const result = await policy.check(ctx);
    results.push({ policy: policy.name, ...result });
    // A block is final; later checks would only add noise.
    if (result.outcome === "block") break;
  }
  return results;
}
