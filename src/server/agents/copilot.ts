import { and, desc, eq } from "drizzle-orm";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import type { ConnectorDeps } from "../connectors/service";
import type { Db } from "../db/client";
import { agentRuns, contacts, conversations, projects } from "../db/schema";
import { withTenant } from "../db/tenant";
import type { GatewayDeps } from "../gateway/gateway";
import { defineTool, runAgentLoop } from "../llm/agent-loop";
import type { LlmClient } from "../llm/client";
import { activePlaybookFor } from "../playbooks/service";
import { renderPlaybook } from "../playbooks/spec";
import {
  actionTools,
  calendarTools,
  crmTools,
  knowledgeTools,
  projectIdentityHints,
  type AgentToolContext,
} from "./tools";

export type CopilotTurn = { role: "user" | "assistant"; content: string };

export type CopilotAnswer = {
  answer: string;
  status: "completed" | "refused" | "max_turns" | "truncated";
  runId: string;
  proposedActions: { actionId: string; outcome: string }[];
  costUsd: number;
};

/**
 * Conversational assistant over one project: answers from the project's
 * knowledge (with sources) and can prepare actions, which land in the
 * approval inbox like any agent proposal.
 */
export async function askCopilot(
  deps: {
    db: Db;
    llm: LlmClient;
    gateway: GatewayDeps;
    connectors?: Omit<ConnectorDeps, "db">;
    now?: () => Date;
  },
  tenant: { orgId: string; userId: string },
  input: { projectId: string; history: CopilotTurn[]; question: string },
): Promise<CopilotAnswer> {
  const now = deps.now?.() ?? new Date();
  const { project, playbook, run } = await withTenant(deps.db, tenant, async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, input.projectId));
    if (!project) throw new Error("Proyecto no encontrado.");
    const playbook = await activePlaybookFor(tx, project.id, "inbound");
    const [run] = await tx
      .insert(agentRuns)
      .values({
        orgId: tenant.orgId,
        projectId: project.id,
        agentType: "copilot",
        trigger: "copilot",
        triggerRef: tenant.userId,
        model: deps.llm.model,
      })
      .returning();
    return { project, playbook, run };
  });

  const ctx: AgentToolContext = {
    db: deps.db,
    orgId: tenant.orgId,
    projectId: project.id,
    agentType: "copilot",
    runId: run.id,
    gateway: deps.gateway,
    connectors: deps.connectors,
    timezone: project.timezone,
    now: deps.now,
  };

  const recentConversations = defineTool({
    name: "list_conversations",
    description:
      "Lista las conversaciones recientes del proyecto con su contacto, estado, clasificación y resumen.",
    input: z.object({
      status: z.enum(["open", "waiting_customer", "waiting_us", "handed_off", "closed"]).optional(),
      limit: z.number().int().min(1).max(50).default(15),
    }),
    run: async ({ status, limit }) =>
      withTenant(deps.db, tenant, async (tx) => {
        const rows = await tx
          .select({ conversation: conversations, contact: contacts })
          .from(conversations)
          .leftJoin(contacts, eq(contacts.id, conversations.contactId))
          .where(
            and(
              eq(conversations.projectId, project.id),
              status ? eq(conversations.status, status) : undefined,
            ),
          )
          .orderBy(desc(conversations.lastMessageAt))
          .limit(limit);
        return rows.map((r) => ({
          conversationId: r.conversation.id,
          channel: r.conversation.channel,
          status: r.conversation.status,
          classification: r.conversation.classification,
          summary: r.conversation.summary,
          lastMessageAt: r.conversation.lastMessageAt,
          contact: r.contact
            ? {
                name: [r.contact.firstName, r.contact.lastName].filter(Boolean).join(" "),
                email: r.contact.email,
                company: r.contact.companyName,
                status: r.contact.status,
              }
            : null,
        }));
      }),
  });

  const identitiesHint = await projectIdentityHints(ctx);
  const system = [
    `Eres el copiloto comercial del proyecto «${project.name}». Ayudas a la persona responsable a entender su información comercial, preparar llamadas y mensajes, y revisar cómo van los contactos.`,
    `## El proyecto\n${project.description ?? "(sin descripción)"}\nWeb: ${project.website ?? "—"} · Zona horaria: ${project.timezone}`,
    `## Cómo respondes
- Responde a partir del conocimiento del proyecto (search_knowledge, list_tables, query_table), su CRM y sus conversaciones. Indica de qué fuente sale cada dato; si algo no está en las fuentes, dilo.
- Respuestas breves y directas, en español, con listas cuando ayuden.
- Si te piden preparar un email, una tarea o una reunión, propónlo con propose_action: quedará en la bandeja de aprobación. Dilo así, sin dar por hecho que se ha enviado.`,
    identitiesHint.length
      ? `## Identidades del proyecto\n${identitiesHint.map((i) => `- ${i.kind} ${i.address} (id ${i.id})`).join("\n")}`
      : "",
    playbook
      ? renderPlaybook({ name: playbook.name, motion: playbook.salesMotion, spec: playbook.spec })
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const local = new Intl.DateTimeFormat("es-ES", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: project.timezone,
  }).format(now);
  const messages: BetaMessageParam[] = [
    ...input.history.slice(-12).map((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: `(${local}) ${input.question}` },
  ];

  const result = await runAgentLoop({
    llm: deps.llm,
    system,
    messages,
    tools: [
      ...knowledgeTools(ctx),
      ...crmTools(ctx),
      ...calendarTools(ctx),
      recentConversations,
      actionTools(ctx, [
        "email.create_draft",
        "email.send",
        "crm.upsert_contact",
        "crm.create_task",
        "crm.log_note",
        "calendar.book",
      ]),
    ],
    effort: "medium",
  });

  const proposedActions = result.steps
    .filter(
      (s): s is Extract<typeof s, { type: "tool_result" }> =>
        s.type === "tool_result" && s.name === "propose_action",
    )
    .map((s) => s.output as { actionId?: string; outcome?: string })
    .filter((o) => o.actionId)
    .map((o) => ({ actionId: o.actionId!, outcome: o.outcome ?? "" }));

  await withTenant(deps.db, tenant, (tx) =>
    tx
      .update(agentRuns)
      .set({
        status:
          result.status === "refused" ? "refused" : result.status === "completed" ? "completed" : "failed",
        model: result.model,
        inputTokens: result.usage.input,
        outputTokens: result.usage.output,
        cacheReadTokens: result.usage.cacheRead,
        costUsd: result.costUsd,
        steps: result.steps,
        summary: result.finalText,
        finishedAt: new Date(),
      })
      .where(eq(agentRuns.id, run.id)),
  );

  return {
    answer:
      result.status === "refused"
        ? "No puedo ayudarte con esta petición."
        : result.finalText || "No he podido elaborar una respuesta.",
    status: result.status,
    runId: run.id,
    proposedActions,
    costUsd: result.costUsd,
  };
}
