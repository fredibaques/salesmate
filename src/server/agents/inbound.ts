import { and, asc, eq, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { ConnectorDeps } from "../connectors/service";
import type { Db } from "../db/client";
import {
  agentConfigs,
  agentRuns,
  connections,
  CONTACT_STATUSES,
  contacts,
  conversations,
  identities,
  inboundEvents,
  messages,
  projects,
} from "../db/schema";
import { withTenant } from "../db/tenant";
import type { GatewayDeps } from "../gateway/gateway";
import { runAgentLoop, defineTool, type AgentTool } from "../llm/agent-loop";
import { withModel, type LlmClient } from "../llm/client";
import { projectProcess, type PlaybookWithSpec } from "../playbooks/service";
import { parseSalesProfile, renderPlaybook } from "../playbooks/spec";
import { conversationRef, findOrCreateConversation, upsertContact, type Lead } from "./conversations";
import { recordLeadRow } from "./inbound-table";
import {
  leadFromEmail,
  leadFromForm,
  leadFromWhatsapp,
  looksAutomated,
  type GmailInboundPayload,
  type WhatsappInboundPayload,
} from "./leads";
import {
  actionTools,
  calendarTools,
  crmTools,
  knowledgeTools,
  mcpTools,
  projectIdentityHints,
  webTools,
  type AgentToolContext,
} from "./tools";

export type InboundDeps = {
  db: Db;
  llm: LlmClient;
  gateway: GatewayDeps;
  connectors?: Omit<ConnectorDeps, "db">;
  now?: () => Date;
};

export type InboundOutcome =
  | { status: "processed"; runId: string; conversationId: string; summary: string }
  | { status: "ignored"; reason: string }
  /** A person took the conversation over: the message is kept, the agent doesn't answer. */
  | { status: "handed_off"; conversationId: string }
  | { status: "skipped" }
  | { status: "error"; error: string };

const MAX_ATTEMPTS = 3;

function leadFromEvent(
  source: string,
  payload: Record<string, unknown>,
): { lead: Lead; automated: boolean } | null {
  if (source === "form") {
    const lead = leadFromForm((payload.fields ?? payload) as Record<string, unknown>);
    return { lead, automated: false };
  }
  if (source === "gmail") {
    const email = payload as unknown as GmailInboundPayload;
    return { lead: leadFromEmail(email), automated: email.autoSubmitted };
  }
  if (source === "whatsapp") {
    return { lead: leadFromWhatsapp(payload as unknown as WhatsappInboundPayload), automated: false };
  }
  return null;
}

function systemPrompt(input: {
  project: typeof projects.$inferSelect;
  playbook: PlaybookWithSpec | null;
  identities: { id: string; kind: string; address: string; isDefault: boolean }[];
  instructions?: string | null;
}): string {
  const { project, playbook } = input;
  const mailboxes = input.identities.filter((i) => i.kind === "email");
  const calendars = input.identities.filter((i) => i.kind === "calendar");
  const defaultMailbox = mailboxes.find((m) => m.isDefault) ?? mailboxes[0];

  return [
    `Eres el agente inbound de «${project.name}». Atiendes a quien acaba de contactar con el proyecto y preparas el siguiente paso comercial siguiendo el playbook. Trabajas para una persona del equipo que revisará lo que propongas.`,
    `## El proyecto\n${project.description ?? "(sin descripción)"}\nWeb: ${project.website ?? "—"} · Idiomas: ${project.languages.join(", ")} · Zona horaria: ${project.timezone}`,
    `## Cómo trabajas
- Antes de afirmar cualquier hecho sobre la oferta (precios, plazos, condiciones, coberturas, disponibilidad), búscalo con search_knowledge, list_tables y query_table. Si no lo encuentras en una fuente, no lo inventes: dilo con naturalidad y deriva a una persona.
- Cualifica al contacto según el playbook y registra tu valoración con update_lead.
- Elige el siguiente paso permitido por el playbook y propónlo con propose_action. Lo habitual es una respuesta al contacto${defaultMailbox ? ` (email.send desde la identidad ${defaultMailbox.id}, ${defaultMailbox.address})` : ""} y, si el proyecto tiene CRM, crear o actualizar el contacto y una tarea para la persona responsable.
- Cuando cites precios o condiciones en un mensaje, incluye en citations el sourceId y el rowId o chunkId de donde salen.
- Escribe al contacto en su idioma, con el tono del playbook, en texto plano y sin inventar nombres de personas del equipo.
- Las acciones no se ejecutan solas: el sistema aplica las reglas del proyecto y puede pedir aprobación, programarlas o bloquearlas. Si una propuesta se bloquea, no insistas con variaciones: explícalo en tu resumen.
- Si el mensaje es spam, publicidad o no es una consulta comercial, márcalo con update_lead (classification) y no respondas.
- Termina con un resumen de 2 a 4 frases para la persona responsable: qué pide el contacto, tu valoración y qué has propuesto.`,
    `## Identidades del proyecto\n${
      input.identities.length
        ? input.identities
            .map((i) => `- ${i.kind} ${i.address} (id ${i.id})${i.isDefault ? " · por defecto" : ""}`)
            .join("\n")
        : "- Ninguna asignada: no puedes enviar emails ni reservar reuniones; propone una tarea en el CRM o deriva."
    }${calendars.length ? "" : "\n(No hay calendario asignado: no reserves reuniones directamente; ofrece huecos solo si get_availability los devuelve.)"}`,
    playbook
      ? renderPlaybook({
          name: playbook.name,
          motion: playbook.salesMotion,
          spec: playbook.spec,
          profile: parseSalesProfile(project.salesProfile),
        })
      : "## Proceso de venta\nEste proyecto aún no tiene proceso de venta. Limítate a un acuse de recibo cordial que confirme que alguien del equipo responderá pronto, y crea una tarea para que una persona lo atienda.",
    input.instructions ? `## Instrucciones de la persona responsable\n${input.instructions}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function leadMessage(input: {
  lead: Lead;
  contact: typeof contacts.$inferSelect;
  history: (typeof messages.$inferSelect)[];
  now: Date;
  timezone: string;
}): string {
  const { lead } = input;
  const local = new Intl.DateTimeFormat("es-ES", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: input.timezone,
  }).format(input.now);
  const who = [
    [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "(sin nombre)",
    lead.email ? `<${lead.email}>` : null,
    lead.phone ? `tel. ${lead.phone}` : null,
    lead.companyName ? `de ${lead.companyName}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const extra = Object.entries(lead.extra);
  const history = input.history
    .slice(-10)
    .map(
      (m) =>
        `[${m.direction === "inbound" ? "Contacto" : "Nosotros"} · ${m.sentAt.toISOString()}] ${m.subject ? `${m.subject}: ` : ""}${m.body}`,
    )
    .join("\n\n");

  return [
    `Ahora son las ${local}.`,
    `Nuevo mensaje por ${lead.channel === "form" ? "formulario web" : lead.channel === "whatsapp" ? "WhatsApp" : "email"} de ${who}.`,
    lead.channel === "whatsapp"
      ? `Responde por WhatsApp (whatsapp.send al ${lead.phone}, desde la identidad de WhatsApp del proyecto): mensajes cortos, en texto plano, sin asunto.`
      : null,
    lead.subject ? `Asunto: ${lead.subject}` : null,
    `Mensaje:\n${lead.body || "(vacío)"}`,
    extra.length ? `Otros campos:\n${extra.map(([k, v]) => `- ${k}: ${v}`).join("\n")}` : null,
    lead.externalThreadId
      ? `Para responder en el mismo hilo incluye en el email threadId=${lead.externalThreadId}${lead.rfcMessageId ? ` e inReplyToMessageId=${lead.rfcMessageId}` : ""}${lead.subject ? ` y el asunto «Re: ${lead.subject.replace(/^re:\s*/i, "")}»` : ""}.`
      : null,
    `Estado actual del contacto: ${input.contact.status}${input.contact.crmExternalId ? ` · id en el CRM ${input.contact.crmExternalId}` : ""}.`,
    history
      ? `Historial reciente de la conversación:\n${history}`
      : "Es el primer mensaje de esta conversación.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function leadStateTool(ctx: { db: Db; orgId: string; contactId: string; conversationId: string }): AgentTool {
  return defineTool({
    name: "update_lead",
    description:
      "Guarda tu valoración del contacto y de la conversación: estado, encaje (0-100), clasificación, resumen y siguiente paso. También corrige sus datos si el mensaje los aclara.",
    input: z.object({
      status: z.enum(CONTACT_STATUSES).optional(),
      fitScore: z.number().int().min(0).max(100).optional(),
      classification: z
        .string()
        .optional()
        .describe("p. ej. interesado, pide presupuesto, consulta, cliente actual, soporte, no encaja, spam"),
      summary: z.string().optional(),
      nextStep: z.string().optional(),
      conversationStatus: z
        .enum(["open", "waiting_customer", "waiting_us", "handed_off", "closed"])
        .optional(),
      customerType: z.enum(["b2b", "b2c"]).optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      companyName: z.string().optional(),
      jobTitle: z.string().optional(),
      phone: z.string().optional(),
      crmExternalId: z
        .string()
        .optional()
        .describe("Id del contacto en el CRM si lo has creado o encontrado"),
    }),
    run: async (input) =>
      withTenant(ctx.db, { orgId: ctx.orgId }, async (tx) => {
        const contactPatch = Object.fromEntries(
          Object.entries({
            status: input.status,
            fitScore: input.fitScore,
            customerType: input.customerType,
            firstName: input.firstName,
            lastName: input.lastName,
            companyName: input.companyName,
            jobTitle: input.jobTitle,
            phone: input.phone,
            crmExternalId: input.crmExternalId,
          }).filter(([, v]) => v !== undefined),
        );
        if (Object.keys(contactPatch).length) {
          await tx.update(contacts).set(contactPatch).where(eq(contacts.id, ctx.contactId));
        }
        const conversationPatch = Object.fromEntries(
          Object.entries({
            classification: input.classification,
            summary: input.summary,
            nextStep: input.nextStep,
            status: input.conversationStatus,
          }).filter(([, v]) => v !== undefined),
        );
        if (Object.keys(conversationPatch).length) {
          await tx
            .update(conversations)
            .set(conversationPatch)
            .where(eq(conversations.id, ctx.conversationId));
        }
        return { ok: true };
      }),
  });
}

/**
 * Processes one inbound event end to end: lead → contact → conversation →
 * agent run (with the project's playbook) → proposed actions in the gateway.
 * Safe to call concurrently: the event is claimed first.
 */
export async function processInboundEvent(
  deps: InboundDeps,
  orgId: string,
  eventId: string,
): Promise<InboundOutcome> {
  const now = deps.now?.() ?? new Date();
  const tenant = { orgId };

  const event = await withTenant(deps.db, tenant, async (tx) => {
    const [claimed] = await tx
      .update(inboundEvents)
      .set({ status: "processing", attempts: sql`${inboundEvents.attempts} + 1` })
      .where(
        and(
          eq(inboundEvents.id, eventId),
          or(
            eq(inboundEvents.status, "pending"),
            and(eq(inboundEvents.status, "error"), lt(inboundEvents.attempts, MAX_ATTEMPTS)),
          ),
        ),
      )
      .returning();
    return claimed ?? null;
  });
  if (!event) return { status: "skipped" };

  const finish = async (status: "processed" | "ignored" | "error", error?: string) =>
    withTenant(deps.db, tenant, (tx) =>
      tx
        .update(inboundEvents)
        .set({ status, error: error ?? null, processedAt: new Date() })
        .where(eq(inboundEvents.id, eventId)),
    );

  try {
    const parsed = leadFromEvent(event.source, event.payload);
    if (!parsed) {
      await finish("ignored", `Origen sin agente inbound: ${event.source}`);
      return { status: "ignored", reason: "unsupported_source" };
    }
    if (!event.projectId) {
      await finish("ignored", "El evento no está asociado a ningún proyecto.");
      return { status: "ignored", reason: "no_project" };
    }
    const { lead, automated } = parsed;
    if (!lead.email && !lead.phone) {
      await finish("ignored", "Sin email ni teléfono de contacto.");
      return { status: "ignored", reason: "no_contact_data" };
    }
    if (looksAutomated(lead, automated)) {
      await finish("ignored", "Mensaje automático (fuera de oficina, rebote…).");
      return { status: "ignored", reason: "automated" };
    }

    const prepared = await withTenant(deps.db, tenant, async (tx) => {
      const [project] = await tx.select().from(projects).where(eq(projects.id, event.projectId!));
      if (!project) throw new Error("Proyecto no encontrado.");
      if (lead.email) {
        const own = await tx
          .select({ id: identities.id })
          .from(identities)
          .where(and(eq(identities.kind, "email"), inArray(identities.address, [lead.email.toLowerCase()])));
        if (own.length) return { ownMessage: true as const };
      }
      const playbook = await projectProcess(tx, project.id);
      const [agentConfig] = await tx
        .select()
        .from(agentConfigs)
        .where(and(eq(agentConfigs.projectId, project.id), eq(agentConfigs.agentType, "inbound")));
      const contact = await upsertContact(tx, orgId, project.id, lead, playbook?.spec.customerType ?? null);
      // The agent's table, if it works on one: the person becomes (or finds) their row.
      if (agentConfig?.prospectBaseId) {
        await recordLeadRow(tx, {
          orgId,
          baseId: agentConfig.prospectBaseId,
          agentConfigId: agentConfig.id,
          contactId: contact.id,
          lead,
          now,
        });
      }
      const conversation = await findOrCreateConversation(tx, {
        orgId,
        projectId: project.id,
        contactId: contact.id,
        playbookId: playbook?.id ?? null,
        lead,
        now,
      });
      await tx
        .insert(messages)
        .values({
          orgId,
          conversationId: conversation.id,
          direction: "inbound",
          channel: lead.channel,
          externalId: lead.externalMessageId ?? `event:${event.id}`,
          fromAddress: lead.email,
          subject: lead.subject,
          body: lead.body || JSON.stringify(lead.extra),
          sentAt: now,
          metadata: { extra: lead.extra },
        })
        .onConflictDoNothing();
      // A person took it over: it stays theirs, waiting for them.
      const handedOff = conversation.status === "handed_off";
      await tx
        .update(conversations)
        .set({ status: handedOff ? "handed_off" : "waiting_us", lastMessageAt: now })
        .where(eq(conversations.id, conversation.id));
      if (handedOff) return { ownMessage: false as const, handedOff: true as const, conversation };
      const history = await tx
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversation.id))
        .orderBy(asc(messages.sentAt));
      const [run] = await tx
        .insert(agentRuns)
        .values({
          orgId,
          projectId: project.id,
          agentType: "inbound",
          trigger: "inbound_event",
          triggerRef: event.id,
          playbookVersionId: playbook?.versionId ?? null,
          model: withModel(deps.llm, agentConfig?.settings.model).model,
        })
        .returning();
      return {
        ownMessage: false as const,
        handedOff: false as const,
        project,
        playbook,
        agentConfig: agentConfig ?? null,
        contact,
        conversation,
        history,
        run,
      };
    });

    if (prepared.ownMessage) {
      await finish("ignored", "Mensaje enviado desde una identidad propia.");
      return { status: "ignored", reason: "own_message" };
    }
    if (prepared.handedOff) {
      await finish("processed");
      return { status: "handed_off", conversationId: prepared.conversation.id };
    }
    const { project, playbook, agentConfig, contact, conversation, history, run } = prepared;

    const toolCtx: AgentToolContext = {
      db: deps.db,
      orgId,
      projectId: project.id,
      agentType: "inbound",
      runId: run.id,
      gateway: deps.gateway,
      connectors: deps.connectors,
      timezone: project.timezone,
      now: deps.now,
      actionContext: () => ({
        customerType: playbook?.spec.customerType,
        subjectRef: conversationRef(conversation.id),
      }),
    };
    // Trello and monday.com connections with a place for tasks.
    const taskBoards = (
      await withTenant(deps.db, tenant, (tx) =>
        tx
          .select()
          .from(connections)
          .where(and(inArray(connections.provider, ["trello", "monday"]), eq(connections.status, "active"))),
      )
    )
      .map((c) => ({
        id: c.id,
        label: c.label,
        provider: c.provider,
        target: (c.metadata as { taskTarget?: { label?: string } | null })?.taskTarget?.label ?? null,
      }))
      .filter((b): b is typeof b & { target: string } => Boolean(b.target));
    const needsCalendar = playbook?.spec.nextSteps.some((s) => s === "meeting" || s === "callback") ?? false;
    const tools: AgentTool[] = [
      ...knowledgeTools(toolCtx),
      ...crmTools(toolCtx),
      ...(needsCalendar ? calendarTools(toolCtx) : []),
      leadStateTool({ db: deps.db, orgId, contactId: contact.id, conversationId: conversation.id }),
      actionTools(toolCtx, [
        ...(taskBoards.length ? (["task.create"] as const) : []),
        "email.send",
        "whatsapp.send",
        "email.create_draft",
        "crm.upsert_contact",
        "crm.create_task",
        "crm.log_note",
        "calendar.book",
      ]),
      ...(await mcpTools(toolCtx, agentConfig?.tools.mcp ?? [])),
    ];

    const result = await runAgentLoop({
      llm: withModel(deps.llm, agentConfig?.settings.model),
      system: [
        systemPrompt({
          project,
          playbook,
          identities: await projectIdentityHints(toolCtx),
          instructions: agentConfig?.instructions,
        }),
        taskBoards.length
          ? `## Tableros de tareas del equipo\nPara que una persona haga un seguimiento, además de (o en vez de) una tarea en el CRM, puedes proponer task.create con su connectionId:\n${taskBoards
              .map((b) => `- ${b.label} (${b.provider}, ${b.target}): connectionId ${b.id}`)
              .join("\n")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      messages: [
        {
          role: "user",
          content: leadMessage({
            lead,
            contact,
            history: history.filter((m) => m.externalId !== (lead.externalMessageId ?? `event:${event.id}`)),
            now,
            timezone: project.timezone,
          }),
        },
      ],
      tools,
      serverTools: agentConfig?.tools.web ? webTools(5) : [],
      effort: "medium",
    });

    await withTenant(deps.db, tenant, async (tx) => {
      await tx
        .update(agentRuns)
        .set({
          status:
            result.status === "refused" ? "refused" : result.status === "completed" ? "completed" : "failed",
          error: result.status === "completed" ? null : `Fin del agente: ${result.status}`,
          model: result.model,
          inputTokens: result.usage.input,
          outputTokens: result.usage.output,
          cacheReadTokens: result.usage.cacheRead,
          cacheWriteTokens: result.usage.cacheWrite,
          webSearches: result.usage.webSearches,
          costUsd: result.costUsd,
          steps: result.steps,
          summary: result.finalText,
          finishedAt: new Date(),
        })
        .where(eq(agentRuns.id, run.id));
      const [current] = await tx.select().from(conversations).where(eq(conversations.id, conversation.id));
      if (!current.summary && result.finalText) {
        await tx
          .update(conversations)
          .set({ summary: result.finalText })
          .where(eq(conversations.id, conversation.id));
      }
    });
    await finish("processed");
    return { status: "processed", runId: run.id, conversationId: conversation.id, summary: result.finalText };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finish("error", message);
    return { status: "error", error: message };
  }
}

/** Processes pending events of an organization (oldest first). */
/**
 * Processes queued leads of projects whose inbound agent is added and active.
 * Leads of other projects stay queued until the agent is activated.
 */
export async function processPendingInbound(deps: InboundDeps, orgId: string, limit = 20) {
  const pending = await withTenant(deps.db, { orgId }, (tx) =>
    tx
      .select({ id: inboundEvents.id })
      .from(inboundEvents)
      .innerJoin(
        agentConfigs,
        and(
          eq(agentConfigs.projectId, inboundEvents.projectId),
          eq(agentConfigs.agentType, "inbound"),
          eq(agentConfigs.enabled, true),
          isNotNull(agentConfigs.addedAt),
        ),
      )
      .where(
        or(
          eq(inboundEvents.status, "pending"),
          and(eq(inboundEvents.status, "error"), lt(inboundEvents.attempts, MAX_ATTEMPTS)),
        ),
      )
      .orderBy(asc(inboundEvents.receivedAt))
      .limit(limit),
  );
  const outcomes: InboundOutcome[] = [];
  for (const { id } of pending) outcomes.push(await processInboundEvent(deps, orgId, id));
  return outcomes;
}
