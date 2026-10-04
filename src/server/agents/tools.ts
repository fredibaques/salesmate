import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getAvailability } from "../calendar/availability";
import { openConnection, type ConnectorDeps } from "../connectors/service";
import type { Db } from "../db/client";
import {
  identities,
  knowledgeSources,
  knowledgeTables,
  meetingTypes,
  projectConnections,
  projectIdentities,
  type ActionContext,
  type AgentType,
} from "../db/schema";
import { withTenant } from "../db/tenant";
import { ACTION_DEFINITIONS } from "../gateway/definitions";
import { GatewayError, proposeAction, type GatewayDeps } from "../gateway/gateway";
import { queryTable, searchKnowledge, tableQuerySchema } from "../knowledge/service";
import { defineTool, type AgentTool } from "../llm/agent-loop";

export type AgentToolContext = {
  db: Db;
  orgId: string;
  projectId: string;
  agentType: AgentType;
  runId: string;
  gateway: GatewayDeps;
  connectors?: Omit<ConnectorDeps, "db">;
  /** Facts attached to every action this run proposes (customer type, conversation…). */
  actionContext?: () => ActionContext;
  timezone: string;
  now?: () => Date;
};

const citationSchema = z.object({
  sourceId: z.string().describe("Id de la fuente de conocimiento (sourceId) de la que sale el dato"),
  ref: z.string().describe("Id del fragmento (chunkId) o de la fila (rowId) citado"),
});

/** Read-only tools: the "see" layer. */
export function knowledgeTools(ctx: AgentToolContext): AgentTool[] {
  const tenant = { orgId: ctx.orgId };
  return [
    defineTool({
      name: "search_knowledge",
      description:
        "Busca en los documentos del proyecto (presentaciones, FAQs, objeciones, condiciones). Devuelve fragmentos con sourceId y chunkId para citarlos. Úsalo antes de afirmar cualquier hecho sobre la oferta.",
      input: z.object({ query: z.string().min(2).describe("Qué buscas, en lenguaje natural") }),
      run: async ({ query }) => {
        const hits = await searchKnowledge(ctx.db, tenant, { projectId: ctx.projectId, query, limit: 6 });
        return hits.map((h) => ({
          sourceId: h.sourceId,
          chunkId: h.chunkId,
          source: h.sourceName,
          reliability: h.reliability,
          content: h.content,
        }));
      },
    }),
    defineTool({
      name: "list_tables",
      description:
        "Lista las tablas de datos del proyecto (tarifas, catálogos…) con sus columnas. Las de fiabilidad 'truth' son las únicas válidas para dar precios o condiciones.",
      input: z.object({}),
      run: async () =>
        withTenant(ctx.db, tenant, async (tx) => {
          const rows = await tx
            .select({
              tableId: knowledgeTables.id,
              name: knowledgeTables.name,
              columns: knowledgeTables.columns,
              rowCount: knowledgeTables.rowCount,
              sourceId: knowledgeSources.id,
              source: knowledgeSources.name,
              reliability: knowledgeSources.reliability,
            })
            .from(knowledgeTables)
            .innerJoin(knowledgeSources, eq(knowledgeSources.id, knowledgeTables.sourceId))
            .where(eq(knowledgeSources.projectId, ctx.projectId));
          return rows;
        }),
    }),
    defineTool({
      name: "query_table",
      description:
        "Consulta filas de una tabla del proyecto con filtros. Devuelve rowId para citarlas. Operadores: eq, neq, lt, lte, gt, gte, contains, in.",
      input: tableQuerySchema,
      run: async (query) => {
        const result = await queryTable(ctx.db, tenant, query);
        return {
          sourceId: result.source.id,
          reliability: result.source.reliability,
          columns: result.table.columns,
          rows: result.rows.map((r) => ({ rowId: r.id, ...r.data })),
        };
      },
    }),
  ];
}

/** CRM lookups through the project's connection. */
export function crmTools(ctx: AgentToolContext): AgentTool[] {
  const tenant = { orgId: ctx.orgId };
  return [
    defineTool({
      name: "crm_find_person",
      description: "Busca una persona en el CRM del proyecto por email o por nombre para conocer su historial.",
      input: z.object({ email: z.string().email().optional(), query: z.string().optional() }),
      run: async ({ email, query }) => {
        const connectionId = await withTenant(ctx.db, tenant, async (tx) => {
          const [link] = await tx
            .select({ connectionId: projectConnections.connectionId })
            .from(projectConnections)
            .where(
              and(
                eq(projectConnections.projectId, ctx.projectId),
                sql`'crm.search_people' = any(${projectConnections.capabilities})`,
              ),
            )
            .limit(1);
          return link?.connectionId;
        });
        if (!connectionId) return { error: "El proyecto no tiene un CRM con lectura de contactos." };
        const { client } = await openConnection({ db: ctx.db, ...ctx.connectors }, tenant, connectionId);
        return client["crm.search_people"]!({ email, query, limit: 5 });
      },
    }),
  ];
}

/** Meeting types and real availability (only useful when the playbook books meetings). */
export function calendarTools(ctx: AgentToolContext): AgentTool[] {
  const tenant = { orgId: ctx.orgId };
  return [
    defineTool({
      name: "list_meeting_types",
      description: "Lista los tipos de reunión del proyecto (demo, descubrimiento, callback…).",
      input: z.object({}),
      run: async () =>
        withTenant(ctx.db, tenant, (tx) =>
          tx
            .select({
              meetingTypeId: meetingTypes.id,
              name: meetingTypes.name,
              kind: meetingTypes.kind,
              durationMinutes: meetingTypes.durationMinutes,
              calendarIdentityId: meetingTypes.calendarIdentityId,
              location: meetingTypes.location,
            })
            .from(meetingTypes)
            .where(and(eq(meetingTypes.projectId, ctx.projectId), eq(meetingTypes.active, true))),
        ),
    }),
    defineTool({
      name: "get_availability",
      description:
        "Devuelve los próximos huecos libres reales para un tipo de reunión (tiene en cuenta todos los calendarios de la persona). Ofrece 2-3 opciones al contacto.",
      input: z.object({ meetingTypeId: z.string().uuid() }),
      run: async ({ meetingTypeId }) => {
        const { slots, warnings } = await getAvailability(
          { db: ctx.db, ...ctx.connectors, now: ctx.now },
          tenant,
          meetingTypeId,
        );
        const fmt = new Intl.DateTimeFormat("es-ES", {
          weekday: "long",
          day: "numeric",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: ctx.timezone,
        });
        return {
          slots: slots.slice(0, 10).map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString(), local: fmt.format(s.start) })),
          warnings,
        };
      },
    }),
  ];
}

/** Identities the project may act through, so the agent can fill identityId. */
export async function projectIdentityHints(ctx: Pick<AgentToolContext, "db" | "orgId" | "projectId">) {
  return withTenant(ctx.db, { orgId: ctx.orgId }, async (tx) => {
    const links = await tx.select().from(projectIdentities).where(eq(projectIdentities.projectId, ctx.projectId));
    if (links.length === 0) return [];
    const rows = await tx
      .select({ id: identities.id, kind: identities.kind, address: identities.address })
      .from(identities)
      .where(inArray(identities.id, links.map((l) => l.identityId)));
    return rows.map((r) => ({ ...r, isDefault: links.find((l) => l.identityId === r.id)?.isDefault ?? false }));
  });
}

/**
 * The only way an agent acts: it proposes, the gateway decides (execute,
 * schedule, ask for approval or block) according to the project's rules.
 */
export function actionTools(ctx: AgentToolContext, allowed: (keyof typeof ACTION_DEFINITIONS)[]): AgentTool {
  const descriptions = allowed
    .map((t) => `- ${t}: ${ACTION_DEFINITIONS[t].label}`)
    .join("\n");
  return defineTool({
    name: "propose_action",
    description: `Propone una acción con efecto externo. No se ejecuta directamente: pasa por las reglas del proyecto y puede quedar pendiente de aprobación humana, programada o bloqueada. Tipos permitidos:\n${descriptions}\nIncluye en citations las fuentes (sourceId + chunkId/rowId) de cualquier precio, plazo o condición que menciones.`,
    input: z.object({
      type: z.enum(allowed as [string, ...string[]]),
      payload: z.record(z.string(), z.unknown()).describe("Contenido de la acción según su tipo"),
      reason: z.string().describe("Por qué propones esta acción (lo verá la persona que apruebe)"),
      citations: z.array(citationSchema).default([]),
    }),
    run: async ({ type, payload, reason, citations }) => {
      try {
        const result = await proposeAction(
          ctx.gateway,
          { orgId: ctx.orgId, actorType: "agent", actorId: ctx.runId },
          {
            projectId: ctx.projectId,
            type,
            payload,
            reason,
            citations,
            agentType: ctx.agentType,
            runId: ctx.runId,
            context: ctx.actionContext?.() ?? {},
          },
        );
        return {
          actionId: result.action.id,
          outcome: result.outcome,
          notes: result.action.policyResults.filter((p) => p.outcome !== "allow").map((p) => p.reason),
          error: result.action.error ?? undefined,
        };
      } catch (err) {
        if (err instanceof GatewayError) return { error: err.message, details: err.details };
        throw err;
      }
    },
  });
}
