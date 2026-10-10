import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getAvailability } from "../calendar/availability";
import { connectionCapabilities, openConnection, type ConnectorDeps } from "../connectors/service";
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
import { callStoredMcpTool, mcpToolsOf, type McpDeps } from "../connectors/mcp";
import { connections } from "../db/schema";
import { knowledgeOf, queryTable, searchKnowledge, tableQuerySchema } from "../knowledge/service";
import { defineTool, type AgentTool, type ServerTool } from "../llm/agent-loop";

export type AgentToolContext = {
  db: Db;
  orgId: string;
  projectId: string;
  agentType: AgentType;
  /** The agent running (null for the copilot). */
  agentConfigId?: string | null;
  runId: string;
  gateway: GatewayDeps;
  connectors?: Omit<ConnectorDeps, "db">;
  mcp?: McpDeps;
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
export function knowledgeTools(ctx: Pick<AgentToolContext, "db" | "orgId" | "projectId">): AgentTool[] {
  const tenant = { orgId: ctx.orgId };
  return [
    defineTool({
      name: "search_knowledge",
      description:
        "Busca en todo el conocimiento del proyecto: documentos (presentaciones, FAQs, objeciones, condiciones) y el contenido de sus tablas (tarifas, catálogos). Devuelve fragmentos con sourceId y chunkId para citarlos. Úsalo antes de afirmar cualquier hecho sobre la oferta.",
      input: z.object({ query: z.string().min(2).describe("Qué buscas, en lenguaje natural") }),
      run: async ({ query }) => {
        const hits = await searchKnowledge(ctx.db, tenant, { projectId: ctx.projectId, query, limit: 6 });
        return hits.map((h) => ({
          sourceId: h.sourceId,
          chunkId: h.chunkId,
          source: h.sourceName,
          content: h.content,
        }));
      },
    }),
    defineTool({
      name: "list_tables",
      description:
        "Lista las tablas de datos del proyecto (tarifas, catálogos…) con su nota y sus columnas. Cualquier precio o condición que des debe salir de aquí o de los documentos.",
      input: z.object({}),
      run: async () =>
        withTenant(ctx.db, tenant, async (tx) => {
          const rows = await tx
            .select({
              tableId: knowledgeTables.id,
              name: knowledgeTables.name,
              description: knowledgeTables.description,
              columns: knowledgeTables.columns,
              rowCount: knowledgeTables.rowCount,
              sourceId: knowledgeSources.id,
              source: knowledgeSources.name,
            })
            .from(knowledgeTables)
            .innerJoin(knowledgeSources, eq(knowledgeSources.id, knowledgeTables.sourceId))
            .where(knowledgeOf(ctx.projectId));
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
      description:
        "Busca una persona en el CRM del proyecto por email o por nombre para conocer su historial.",
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
          slots: slots.slice(0, 10).map((s) => ({
            start: s.start.toISOString(),
            end: s.end.toISOString(),
            local: fmt.format(s.start),
          })),
          warnings,
        };
      },
    }),
  ];
}

/** Identities the project may act through, so the agent can fill identityId. */
export async function projectIdentityHints(ctx: Pick<AgentToolContext, "db" | "orgId" | "projectId">) {
  return withTenant(ctx.db, { orgId: ctx.orgId }, async (tx) => {
    const links = await tx
      .select()
      .from(projectIdentities)
      .where(eq(projectIdentities.projectId, ctx.projectId));
    if (links.length === 0) return [];
    const rows = await tx
      .select({ id: identities.id, kind: identities.kind, address: identities.address })
      .from(identities)
      .where(
        inArray(
          identities.id,
          links.map((l) => l.identityId),
        ),
      );
    return rows.map((r) => ({
      ...r,
      isDefault: links.find((l) => l.identityId === r.id)?.isDefault ?? false,
    }));
  });
}

/**
 * The only way an agent acts: it proposes, the gateway decides (execute,
 * schedule, ask for approval or block) according to the project's rules.
 */
export function actionTools(ctx: AgentToolContext, allowed: (keyof typeof ACTION_DEFINITIONS)[]): AgentTool {
  const descriptions = allowed.map((t) => `- ${t}: ${ACTION_DEFINITIONS[t].label}`).join("\n");
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
            agentConfigId: ctx.agentConfigId ?? undefined,
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

/** Tool names the API accepts: letters, digits, _ and -, up to 64 characters. */
function toolName(server: string, tool: string): string {
  const clean = (v: string) => v.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return `${clean(server).slice(0, 20) || "mcp"}__${clean(tool)}`.slice(0, 64);
}

/**
 * Tools of the MCP servers this agent may use. Read-only tools answer
 * directly; the rest are proposed to the gateway as `mcp.call_tool`.
 */
export async function mcpTools(
  ctx: AgentToolContext,
  allowed: { connectionId: string; tools: string[] }[],
): Promise<AgentTool[]> {
  if (allowed.length === 0) return [];
  const tenant = { orgId: ctx.orgId };
  const servers = await withTenant(ctx.db, tenant, (tx) =>
    tx
      .select()
      .from(connections)
      .where(
        inArray(
          connections.id,
          allowed.map((a) => a.connectionId),
        ),
      ),
  );
  const out: AgentTool[] = [];
  for (const server of servers) {
    if (server.provider !== "mcp" || server.status !== "active") continue;
    const names = new Set(allowed.find((a) => a.connectionId === server.id)?.tools ?? []);
    for (const tool of mcpToolsOf(server).filter((t) => names.has(t.name))) {
      const readOnly = tool.readOnly;
      out.push({
        name: toolName(server.label, tool.name),
        description: [
          `[${server.label}] ${tool.description ?? tool.title ?? tool.name}`,
          readOnly
            ? "Solo lectura."
            : "Modifica datos fuera: se propone como acción y puede quedar pendiente de aprobación.",
        ].join(" "),
        input: z.record(z.string(), z.unknown()),
        jsonSchema: { type: "object", ...tool.inputSchema },
        run: async (args) => {
          const input = args as Record<string, unknown>;
          if (readOnly) {
            return callStoredMcpTool({ db: ctx.db, ...ctx.mcp }, tenant, {
              connectionId: server.id,
              tool: tool.name,
              arguments: input,
            });
          }
          try {
            const result = await proposeAction(
              ctx.gateway,
              { orgId: ctx.orgId, actorType: "agent", actorId: ctx.runId },
              {
                projectId: ctx.projectId,
                type: "mcp.call_tool",
                payload: { connectionId: server.id, server: server.label, tool: tool.name, arguments: input },
                reason: `Herramienta «${tool.name}» de ${server.label}`,
                agentType: ctx.agentType,
                agentConfigId: ctx.agentConfigId ?? undefined,
                runId: ctx.runId,
                context: ctx.actionContext?.() ?? {},
              },
            );
            return {
              actionId: result.action.id,
              outcome: result.outcome,
              result: result.action.result ?? undefined,
              error: result.action.error ?? undefined,
            };
          } catch (err) {
            if (err instanceof GatewayError) return { error: err.message, details: err.details };
            throw err;
          }
        },
      });
    }
  }
  return out;
}

const DATA_PROVIDER_NAMES: Record<string, string> = {
  apollo: "Apollo",
  lusha: "Lusha",
  hunter: "Hunter",
  serper: "Serper",
};

/**
 * Tools of the B2B data providers the agent may use (Apollo, Lusha): find
 * companies and people and get their professional contact details. They
 * only read, so they run directly; enriching spends the provider's credits,
 * which the descriptions say so the agent uses them sparingly.
 */
export async function dataTools(ctx: AgentToolContext, connectionIds: string[]): Promise<AgentTool[]> {
  if (connectionIds.length === 0) return [];
  const tenant = { orgId: ctx.orgId };
  const rows = await withTenant(ctx.db, tenant, (tx) =>
    tx.select().from(connections).where(inArray(connections.id, connectionIds)),
  );
  const out: AgentTool[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const label = DATA_PROVIDER_NAMES[row.provider];
    // One account per provider: tool names must be unique.
    if (!label || row.status !== "active" || seen.has(row.provider)) continue;
    seen.add(row.provider);
    const open = async () => (await openConnection({ db: ctx.db, ...ctx.connectors }, tenant, row.id)).client;
    const call = async <T>(fn: (client: Awaited<ReturnType<typeof open>>) => Promise<T> | undefined) => {
      try {
        const result = await fn(await open());
        return result === undefined ? { error: `${label} no ofrece esta función.` } : result;
      } catch (err) {
        return { error: `${label}: ${err instanceof Error ? err.message : String(err)}` };
      }
    };
    const caps = connectionCapabilities(row);
    const source = `Cada resultado trae sourceUrl: úsalo como fuente (fieldSources) de los datos que guardes de ${label}.`;
    if (caps.includes("data.search_people")) {
      out.push(
        defineTool({
          name: `${row.provider}_search_people`,
          description:
            row.provider === "hunter"
              ? `[${label}] Personas que trabajan en las empresas indicadas (companyDomains, obligatorio), con su cargo y su email de trabajo. Gasta una búsqueda por empresa. ${source}`
              : `[${label}] Busca personas por cargo, empresa (dominio) y zona. No gasta créditos, pero no da email ni teléfono: para eso usa ${row.provider}_enrich_person con quien encaje. ${source}`,
          input: z.object({
            titles: z
              .array(z.string())
              .max(10)
              .optional()
              .describe("Cargos, p. ej. «Gerente», «Director comercial»"),
            keywords: z.string().optional(),
            locations: z
              .array(z.string())
              .max(10)
              .optional()
              .describe("Dónde está la persona: ciudad, región o país"),
            companyDomains: z
              .array(z.string())
              .max(25)
              .optional()
              .describe("Webs de las empresas, p. ej. autosgarcia.es"),
            companyLocations: z.array(z.string()).max(10).optional(),
            employeeRanges: z
              .array(z.string())
              .max(5)
              .optional()
              .describe("Rangos de empleados «min,max», p. ej. «11,50»"),
            limit: z.number().int().min(1).max(25).optional(),
          }),
          run: (input) => call((c) => c["data.search_people"]?.(input)),
        }),
      );
    }
    if (caps.includes("data.search_companies")) {
      out.push(
        defineTool({
          name: `${row.provider}_search_companies`,
          description: `[${label}] Busca empresas por nombre, palabras clave del sector, zona y tamaño. Gasta créditos por página: búscalas con filtros concretos. ${source}`,
          input: z.object({
            name: z.string().optional(),
            keywords: z
              .array(z.string())
              .max(10)
              .optional()
              .describe("Palabras del sector, p. ej. «concesionario»"),
            locations: z.array(z.string()).max(10).optional(),
            employeeRanges: z.array(z.string()).max(5).optional().describe("Rangos de empleados «min,max»"),
            limit: z.number().int().min(1).max(25).optional(),
          }),
          run: (input) => call((c) => c["data.search_companies"]?.(input)),
        }),
      );
    }
    if (caps.includes("data.enrich_person")) {
      out.push(
        defineTool({
          name: `${row.provider}_enrich_person`,
          description: `[${label}] Datos de contacto profesionales de una persona concreta (email de trabajo, teléfonos que se pueden usar, cargo, LinkedIn). Gasta créditos: úsalo solo con quien ya encaja. Identifícala por nombre y empresa (mejor su web), email, LinkedIn o el id que te dio la búsqueda. ${source}`,
          input: z.object({
            name: z.string().optional(),
            firstName: z.string().optional(),
            lastName: z.string().optional(),
            companyName: z.string().optional(),
            companyDomain: z.string().optional(),
            email: z.string().optional(),
            linkedinUrl: z.string().optional(),
            providerId: z.string().optional().describe("Id de la persona en la búsqueda anterior"),
          }),
          run: (input) => call((c) => c["data.enrich_person"]?.(input)),
        }),
      );
    }
    if (caps.includes("data.verify_email")) {
      out.push(
        defineTool({
          name: `${row.provider}_verify_email`,
          description: `[${label}] Comprueba si un email existe y acepta correo (deliverable, risky, undeliverable). Úsalo antes de guardar un email deducido. Gasta una verificación.`,
          input: z.object({ email: z.string().email() }),
          run: (input) => call((c) => c["data.verify_email"]?.(input)),
        }),
      );
    }
    if (caps.includes("data.web_search")) {
      out.push(
        defineTool({
          name: `${row.provider}_search`,
          description: `[${label}] Busca en Google: devuelve título, URL y extracto de cada resultado, y la web oficial si Google la conoce. Mucho más barato que web_search: úsalo primero para encontrar webs, directorios y noticias. Cita como fuente la URL del resultado (o la página que leas).`,
          input: z.object({
            query: z.string().min(2),
            country: z
              .string()
              .length(2)
              .optional()
              .describe("País de los resultados (código ISO), p. ej. es"),
            limit: z.number().int().min(1).max(10).optional(),
          }),
          run: (input) => call((c) => c["data.web_search"]?.(input)),
        }),
      );
    }
    if (caps.includes("data.enrich_company")) {
      out.push(
        defineTool({
          name: `${row.provider}_enrich_company`,
          description: `[${label}] Datos de una empresa por su web: sector, tamaño, ubicación, teléfono y LinkedIn. Gasta créditos. ${source}`,
          input: z.object({ domain: z.string().optional(), name: z.string().optional() }),
          run: (input) => call((c) => c["data.enrich_company"]?.(input)),
        }),
      );
    }
  }
  return out;
}

/**
 * Web tools of the API (searched and read on the provider's side). The caps
 * apply to each request, so they also bound how long one turn of the agent
 * can run before the loop gets control back.
 */
/**
 * Web search and page reading. With `allow`, only those domains (and their
 * subdomains); otherwise never the `block` ones. The API takes one list or
 * the other, so when both are set the allowed list wins (the blocked ones
 * are still named in the prompt).
 */
export function webTools(
  maxSearches: number,
  domains: { allow?: string[]; block?: string[] } = {},
): ServerTool[] {
  const filter = domains.allow?.length
    ? { allowed_domains: domains.allow }
    : domains.block?.length
      ? { blocked_domains: domains.block }
      : {};
  return [
    { type: "web_search_20260209", name: "web_search", max_uses: maxSearches, ...filter },
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: maxSearches * 2, ...filter },
  ];
}
