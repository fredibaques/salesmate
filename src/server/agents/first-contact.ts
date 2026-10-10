import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { BaseColumn } from "@/lib/prospect-columns";
import type { Db } from "../db/client";
import { contacts, conversations, prospects, type AgentSettings } from "../db/schema";
import { withTenant } from "../db/tenant";
import { GatewayError, proposeAction, type GatewayDeps } from "../gateway/gateway";
import { estimateCostUsd, type LlmClient } from "../llm/client";
import { conversationRef } from "./conversations";
import { normalizeEmail } from "../gateway/targets";

/**
 * The next step after prospecting: for rows that fit, the agent writes a
 * first email and proposes it (email.send from its mailbox). The gateway
 * applies the project's rules (send window, exclusions, cooldowns) and, by
 * default, waits for a person to approve it in «Por aprobar». Each row gets
 * one first email at most (prospects.contact_action_id).
 *
 * The email opens a conversation with the row's person (a contact of the
 * project), so it shows in the inbox, and their reply lands in the same
 * thread (the Gmail thread is kept on the conversation once it is sent).
 */

/** The contact and an email conversation for a row the agent is about to write to. */
async function openConversation(
  db: Db,
  orgId: string,
  input: { projectId: string; email: string; row: Row; baseId: string },
) {
  const email = normalizeEmail(input.email);
  const [first, ...rest] = (input.row.personName ?? "").split(/\s+/).filter(Boolean);
  return withTenant(db, { orgId }, async (tx) => {
    const [contact] = await tx
      .insert(contacts)
      .values({
        orgId,
        projectId: input.projectId,
        email,
        firstName: first ?? null,
        lastName: rest.length ? rest.join(" ") : null,
        companyName: input.row.companyName || null,
        customerType: "b2b",
        dataOrigin: "prospecting",
        legalBasis: "legitimate_interest",
        fitScore: input.row.fitScore,
        data: { prospect: { baseId: input.baseId, rowId: input.row.id } },
      })
      .onConflictDoUpdate({
        target: [contacts.projectId, contacts.email],
        set: { updatedAt: new Date() },
      })
      .returning();
    const [conversation] = await tx
      .insert(conversations)
      .values({ orgId, projectId: input.projectId, contactId: contact.id, channel: "email", status: "open" })
      .returning();
    return { contact, conversation };
  });
}

export const DEFAULT_HANDOFF_MIN_FIT = 70;
export const DEFAULT_HANDOFF_PER_RUN = 5;

const EMAIL = z.string().email();

const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "body"],
  properties: {
    subject: { type: "string", description: "Asunto corto, sin mayúsculas de reclamo." },
    body: {
      type: "string",
      description: "Cuerpo del email en texto plano, firmado con el nombre del proyecto.",
    },
  },
} as const;
const draftOutput = z.object({ subject: z.string().min(1).max(300), body: z.string().min(1).max(8000) });

type Row = typeof prospects.$inferSelect;

/** The first email address of the row, from its email columns, or null. */
export function rowEmail(row: Pick<Row, "data">, columns: BaseColumn[]): string | null {
  for (const column of columns) {
    if (column.type !== "email") continue;
    const value = row.data[column.id];
    if (typeof value === "string" && EMAIL.safeParse(value.trim()).success) return value.trim();
  }
  return null;
}

export type FirstContactResult = {
  proposed: number;
  /** Rows the rules didn't let through (excluded, cooldown…), with why. */
  blocked: string[];
  costUsd: number;
  skipped?: string;
};

export async function prepareFirstContacts(
  deps: { db: Db; llm: LlmClient; gateway: GatewayDeps },
  tenant: { orgId: string },
  input: {
    projectId: string;
    /** The prospecting agent that proposes them. */
    agentId?: string;
    projectName: string;
    /** Offer and ideal customer, as the agents read them. */
    profile: string;
    runId: string;
    base: { id: string; columns: BaseColumn[] };
    mailboxId: string | null | undefined;
    handoff: NonNullable<AgentSettings["handoff"]>;
  },
): Promise<FirstContactResult> {
  const result: FirstContactResult = { proposed: 0, blocked: [], costUsd: 0 };
  if (!input.mailboxId) return { ...result, skipped: "El agente no tiene buzón desde el que escribir." };
  const emailColumns = input.base.columns.filter((c) => c.type === "email");
  if (!emailColumns.length) return { ...result, skipped: "La base no tiene ninguna columna de email." };

  const perRun = input.handoff.perRun ?? DEFAULT_HANDOFF_PER_RUN;
  const candidates = await withTenant(deps.db, tenant, (tx) =>
    tx
      .select()
      .from(prospects)
      .where(
        and(
          eq(prospects.baseId, input.base.id),
          inArray(prospects.status, ["new", "accepted"]),
          isNull(prospects.contactActionId),
          gte(prospects.fitScore, input.handoff.minFit ?? DEFAULT_HANDOFF_MIN_FIT),
          sql`(${sql.join(
            emailColumns.map((c) => sql`${prospects.data} ? ${c.id}`),
            sql` or `,
          )})`,
        ),
      )
      .orderBy(desc(prospects.fitScore), asc(prospects.createdAt))
      .limit(perRun * 2),
  );

  const actor = { orgId: tenant.orgId, actorType: "agent" as const, actorId: input.runId };
  for (const row of candidates) {
    if (result.proposed >= perRun) break;
    const to = rowEmail(row, input.base.columns);
    if (!to) continue;
    const known = input.base.columns
      .filter((c) => row.data[c.id] !== undefined && row.data[c.id] !== null)
      .map((c) => `- ${c.name}: ${String(row.data[c.id])}`)
      .join("\n");
    const prompt = [
      `Escribe el primer email comercial del proyecto «${input.projectName}» a este prospecto. Es un primer contacto: breve (90-140 palabras), concreto, sin promesas que no estén en la oferta, con una sola pregunta o propuesta de siguiente paso al final. En español, de usted salvo que el sector use el tuteo. Sin enlaces inventados ni datos que no estén aquí.`,
      `## Oferta y cliente ideal\n${input.profile}`,
      input.handoff.instructions ? `## Indicaciones del equipo\n${input.handoff.instructions}` : "",
      `## El prospecto\n${[
        `- Empresa: ${row.companyName}`,
        row.personName ? `- Persona: ${row.personName}` : null,
        row.website ? `- Web: ${row.website}` : null,
        row.fitReason ? `- Por qué encaja: ${row.fitReason}` : null,
      ]
        .filter(Boolean)
        .join("\n")}\n${known}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    let draft: z.infer<typeof draftOutput>;
    try {
      const response = await deps.llm.create({
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
        output_config: { effort: "low", format: { type: "json_schema", schema: DRAFT_SCHEMA } },
      });
      result.costUsd += estimateCostUsd(response.model, {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
        cacheRead: response.usage.cache_read_input_tokens ?? 0,
        cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
      });
      if (response.stop_reason === "refusal") continue;
      const text = response.content
        .filter((b): b is Extract<(typeof response.content)[number], { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("");
      draft = draftOutput.parse(JSON.parse(text));
    } catch {
      continue;
    }

    const { conversation } = await openConversation(deps.db, tenant.orgId, {
      projectId: input.projectId,
      email: to,
      row,
      baseId: input.base.id,
    });
    const dropConversation = () =>
      withTenant(deps.db, tenant, (tx) =>
        tx.delete(conversations).where(eq(conversations.id, conversation.id)),
      );
    try {
      const proposal = await proposeAction(deps.gateway, actor, {
        projectId: input.projectId,
        type: "email.send",
        agentType: "outbound",
        agentConfigId: input.agentId,
        runId: input.runId,
        payload: { identityId: input.mailboxId, to: [to], subject: draft.subject, body: draft.body },
        context: { customerType: "b2b", subjectRef: conversationRef(conversation.id) },
        reason: `Primer contacto con ${row.personName ?? row.companyName}${row.fitScore != null ? ` (encaje ${row.fitScore})` : ""}${row.fitReason ? `: ${row.fitReason}` : ""}`,
        idempotencyKey: `first-contact:${row.id}`,
      });
      await withTenant(deps.db, tenant, (tx) =>
        tx.update(prospects).set({ contactActionId: proposal.action.id }).where(eq(prospects.id, row.id)),
      );
      if (proposal.outcome === "blocked") {
        // Nothing was said: no conversation to show.
        await dropConversation();
        const why = proposal.action.policyResults.find((p) => p.outcome === "block")?.reason;
        result.blocked.push(`${row.companyName}${why ? `: ${why}` : ""}`);
      } else {
        result.proposed++;
      }
    } catch (err) {
      await dropConversation();
      if (!(err instanceof GatewayError)) throw err;
      result.blocked.push(`${row.companyName}: ${err.message}`);
    }
  }
  return result;
}
