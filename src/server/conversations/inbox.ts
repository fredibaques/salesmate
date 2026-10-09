import { and, asc, desc, eq, inArray, max, ne, sql } from "drizzle-orm";
import { audit } from "../audit";
import { describeConnectorError } from "../connectors/types";
import type { Db } from "../db/client";
import {
  actions,
  agentRuns,
  contacts,
  conversationReads,
  conversations,
  identities,
  meetings,
  messages,
  projectIdentities,
  projects,
} from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { proposeAction, type GatewayDeps } from "../gateway/gateway";
import { foldText } from "../knowledge/normalize";

/**
 * The conversations inbox: one row per person, whatever the channels they
 * wrote through (email, WhatsApp, a form). A person is a contact of a
 * project; a conversation without a contact is a row of its own
 * (`conv:<id>`). Messages of all their conversations make one thread.
 */

export type InboxBox = "needs" | "waiting" | "closed";
type ConversationStatus = (typeof conversations.$inferSelect)["status"];
type User = Pick<TenantContext, "orgId"> & { userId: string };

export type InboxRow = {
  key: string;
  contactId: string | null;
  projectId: string;
  projectName: string;
  projectColor: string | null;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  /** The channels they used, the most recent first. */
  channels: string[];
  lastAt: Date | null;
  last: { body: string; direction: string; channel: string } | null;
  box: InboxBox;
  handedOff: boolean;
  /** Replies or other actions the agents prepared, waiting for a person. */
  pending: number;
  unread: boolean;
};

const NEEDS: ConversationStatus[] = ["open", "waiting_us", "handed_off"];

export function personName(
  contact: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
  } | null,
) {
  return (
    [contact?.firstName, contact?.lastName].filter(Boolean).join(" ") ||
    contact?.email ||
    contact?.phone ||
    "Sin nombre"
  );
}

/** Which box a person is in: someone has to act, the customer has to answer, or it's over. */
export function boxOf(statuses: ConversationStatus[], pending: number): InboxBox {
  if (pending > 0 || statuses.some((s) => NEEDS.includes(s))) return "needs";
  if (statuses.includes("waiting_customer")) return "waiting";
  return "closed";
}

const keyOf = (c: { id: string; contactId: string | null }) => c.contactId ?? `conv:${c.id}`;

/** Actions waiting for a person, by conversation id. */
async function pendingByConversation(tx: Parameters<Parameters<typeof withTenant>[2]>[0]) {
  const rows = await tx
    .select({ context: actions.context })
    .from(actions)
    .where(eq(actions.status, "pending_approval"));
  const out = new Map<string, number>();
  for (const r of rows) {
    const ref = r.context?.subjectRef;
    if (!ref?.startsWith("conversation:")) continue;
    const id = ref.slice("conversation:".length);
    out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}

/**
 * The inbox's rows, the most recent first, with how many are in each box
 * (after the project, channel and search filters).
 */
export async function listInbox(
  db: Db,
  tenant: User,
  filter: { projectId?: string; box?: InboxBox | "all"; channel?: string; q?: string } = {},
): Promise<{ rows: InboxRow[]; counts: Record<InboxBox | "all", number> }> {
  return withTenant(db, tenant, async (tx) => {
    const convs = await tx
      .select({
        conversation: conversations,
        contact: contacts,
        projectName: projects.name,
        projectColor: projects.color,
      })
      .from(conversations)
      .innerJoin(projects, eq(projects.id, conversations.projectId))
      .leftJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(filter.projectId ? eq(conversations.projectId, filter.projectId) : undefined)
      .orderBy(sql`${conversations.lastMessageAt} desc nulls last`)
      .limit(1000);
    const ids = convs.map((c) => c.conversation.id);
    const [lastMessages, lastInbound, pending, reads] = ids.length
      ? await Promise.all([
          tx
            .selectDistinctOn([messages.conversationId], {
              conversationId: messages.conversationId,
              body: messages.body,
              subject: messages.subject,
              direction: messages.direction,
              channel: messages.channel,
              sentAt: messages.sentAt,
            })
            .from(messages)
            .where(and(inArray(messages.conversationId, ids), ne(messages.direction, "internal")))
            .orderBy(messages.conversationId, desc(messages.sentAt)),
          tx
            .select({ conversationId: messages.conversationId, at: max(messages.sentAt) })
            .from(messages)
            .where(and(inArray(messages.conversationId, ids), eq(messages.direction, "inbound")))
            .groupBy(messages.conversationId),
          pendingByConversation(tx),
          tx
            .select({ key: conversationReads.personKey, readAt: conversationReads.readAt })
            .from(conversationReads)
            .where(eq(conversationReads.userId, tenant.userId)),
        ])
      : [[], [], new Map<string, number>(), []];
    const lastBy = new Map(lastMessages.map((m) => [m.conversationId, m]));
    const inboundBy = new Map(lastInbound.map((m) => [m.conversationId, m.at ? new Date(m.at) : null]));
    const readBy = new Map(reads.map((r) => [r.key, r.readAt]));

    const people = new Map<
      string,
      InboxRow & { statuses: ConversationStatus[]; lastInboundAt: Date | null }
    >();
    for (const { conversation: c, contact, projectName, projectColor } of convs) {
      const key = keyOf(c);
      const last = lastBy.get(c.id);
      const at = last?.sentAt ?? c.lastMessageAt;
      let row = people.get(key);
      if (!row) {
        row = {
          key,
          contactId: c.contactId,
          projectId: c.projectId,
          projectName,
          projectColor,
          name: personName(contact),
          company: contact?.companyName ?? null,
          email: contact?.email ?? null,
          phone: contact?.phone ?? null,
          channels: [],
          lastAt: null,
          last: null,
          box: "closed",
          handedOff: false,
          pending: 0,
          unread: false,
          statuses: [],
          lastInboundAt: null,
        };
        people.set(key, row);
      }
      if (!row.channels.includes(c.channel)) row.channels.push(c.channel);
      row.statuses.push(c.status);
      row.pending += pending.get(c.id) ?? 0;
      row.handedOff ||= c.status === "handed_off";
      if (at && (!row.lastAt || at > row.lastAt)) {
        row.lastAt = at;
        row.last = last
          ? { body: last.body || last.subject || "", direction: last.direction, channel: last.channel }
          : row.last;
      }
      const inbound = inboundBy.get(c.id) ?? null;
      if (inbound && (!row.lastInboundAt || inbound > row.lastInboundAt)) row.lastInboundAt = inbound;
    }

    const q = filter.q ? foldText(filter.q).trim() : "";
    const all = [...people.values()]
      .map(({ statuses, lastInboundAt, ...row }) => {
        const readAt = readBy.get(row.key);
        return {
          ...row,
          box: boxOf(statuses, row.pending),
          unread: Boolean(lastInboundAt && (!readAt || lastInboundAt > readAt)),
        };
      })
      .filter((r) => !filter.channel || r.channels.includes(filter.channel))
      .filter((r) => !q || [r.name, r.company, r.email, r.phone].some((v) => v && foldText(v).includes(q)))
      .sort((a, b) => (b.lastAt?.getTime() ?? 0) - (a.lastAt?.getTime() ?? 0));
    const counts = { needs: 0, waiting: 0, closed: 0, all: all.length };
    for (const r of all) counts[r.box]++;
    const box = filter.box ?? "needs";
    return { rows: box === "all" ? all : all.filter((r) => r.box === box), counts };
  });
}

/** The conversations of one person (a contact, or `conv:<id>`). */
async function conversationsOf(tx: Parameters<Parameters<typeof withTenant>[2]>[0], key: string) {
  return tx
    .select()
    .from(conversations)
    .where(key.startsWith("conv:") ? eq(conversations.id, key.slice(5)) : eq(conversations.contactId, key))
    .orderBy(desc(conversations.lastMessageAt));
}

const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Everything about one person: their conversations merged into one thread,
 * what the agents prepared (and wait for approval), meetings, the agent's
 * runs, and how a person can answer them (channels with an identity).
 */
export async function getPerson(db: Db, tenant: Pick<TenantContext, "orgId">, key: string, now = new Date()) {
  return withTenant(db, tenant, async (tx) => {
    const convs = await conversationsOf(tx, key);
    if (!convs.length) return null;
    const ids = convs.map((c) => c.id);
    const projectId = convs[0].projectId;
    const [contact] = convs[0].contactId
      ? await tx.select().from(contacts).where(eq(contacts.id, convs[0].contactId))
      : [null];
    const [project] = await tx.select().from(projects).where(eq(projects.id, projectId));
    const thread = await tx
      .select()
      .from(messages)
      .where(inArray(messages.conversationId, ids))
      .orderBy(asc(messages.sentAt));
    const refs = ids.map((id) => `conversation:${id}`);
    const related = await tx
      .select()
      .from(actions)
      .where(and(eq(actions.projectId, projectId), sql`${actions.context}->>'subjectRef' in ${refs}`))
      .orderBy(asc(actions.createdAt));
    const runIds = [...new Set(related.map((a) => a.runId).filter((r): r is string => Boolean(r)))];
    const runs = runIds.length
      ? await tx
          .select()
          .from(agentRuns)
          .where(inArray(agentRuns.id, runIds))
          .orderBy(desc(agentRuns.startedAt))
      : [];
    const meetingRows = await tx
      .select()
      .from(meetings)
      .where(inArray(meetings.conversationId, ids))
      .orderBy(desc(meetings.startAt));
    const own = await tx
      .select({
        id: identities.id,
        kind: identities.kind,
        address: identities.address,
        isDefault: projectIdentities.isDefault,
      })
      .from(projectIdentities)
      .innerJoin(identities, eq(identities.id, projectIdentities.identityId))
      .where(eq(projectIdentities.projectId, projectId));
    const pick = (kind: "email" | "whatsapp") =>
      own.filter((i) => i.kind === kind).sort((a, b) => Number(b.isDefault) - Number(a.isDefault))[0] ?? null;
    const lastWhatsapp = [...thread]
      .reverse()
      .find((m) => m.channel === "whatsapp" && m.direction === "inbound")?.sentAt;
    const replyChannels = {
      email: contact?.email && pick("email") ? { from: pick("email")!.address } : null,
      whatsapp:
        contact?.phone && pick("whatsapp")
          ? {
              from: pick("whatsapp")!.address,
              // WhatsApp only lets businesses write freely within 24 h of the customer's last message.
              windowOpen: Boolean(
                lastWhatsapp && now.getTime() - lastWhatsapp.getTime() < WHATSAPP_WINDOW_MS,
              ),
            }
          : null,
    };
    const lastInbound = [...thread].reverse().find((m) => m.direction === "inbound");
    return {
      key,
      contact,
      project,
      conversations: convs,
      messages: thread,
      actions: related,
      runs,
      meetings: meetingRows,
      replyChannels,
      /** The channel to answer through by default: the last one they wrote from. */
      preferredChannel:
        lastInbound?.channel === "whatsapp" && replyChannels.whatsapp
          ? ("whatsapp" as const)
          : replyChannels.email
            ? ("email" as const)
            : replyChannels.whatsapp
              ? ("whatsapp" as const)
              : null,
      lastSubject: [...thread].reverse().find((m) => m.subject)?.subject ?? null,
      handedOff: convs.some((c) => c.status === "handed_off"),
      closed: convs.every((c) => c.status === "closed"),
    };
  });
}
export type Person = NonNullable<Awaited<ReturnType<typeof getPerson>>>;

/** The person has been read up to now by this user. */
export async function markRead(db: Db, tenant: User, key: string) {
  await withTenant(db, tenant, (tx) =>
    tx
      .insert(conversationReads)
      .values({ orgId: tenant.orgId, userId: tenant.userId, personKey: key, readAt: new Date() })
      .onConflictDoUpdate({
        target: [conversationReads.orgId, conversationReads.userId, conversationReads.personKey],
        set: { readAt: new Date() },
      }),
  );
}

export type PersonChange = "take_over" | "give_back" | "close" | "reopen";

const CHANGES: Record<PersonChange, { status: ConversationStatus; event: string; skipClosed: boolean }> = {
  // A person answers from now on: the inbound agent keeps the messages but doesn't reply.
  take_over: { status: "handed_off", event: "conversation.taken_over", skipClosed: true },
  give_back: { status: "open", event: "conversation.given_back", skipClosed: true },
  close: { status: "closed", event: "conversation.closed", skipClosed: false },
  reopen: { status: "open", event: "conversation.reopened", skipClosed: false },
};

/** Takes a person over from the agents (or gives them back), or closes or reopens them. */
export async function changePerson(db: Db, tenant: TenantContext, key: string, change: PersonChange) {
  const { status, event, skipClosed } = CHANGES[change];
  return withTenant(db, tenant, async (tx) => {
    const convs = await conversationsOf(tx, key);
    if (!convs.length) throw new Error("Esa conversación ya no existe.");
    const targets = convs.filter((c) => !skipClosed || c.status !== "closed");
    if (targets.length) {
      await tx
        .update(conversations)
        .set({ status, updatedAt: new Date() })
        .where(
          inArray(
            conversations.id,
            targets.map((c) => c.id),
          ),
        );
    }
    await audit(tx, tenant, {
      event,
      projectId: convs[0].projectId,
      entityType: "conversation",
      entityId: convs[0].id,
      data: { conversations: targets.length },
    });
  });
}

/** A note for the team on the thread: the customer never sees it. */
export async function addNote(db: Db, tenant: TenantContext, key: string, author: string, body: string) {
  const text = body.trim();
  if (!text) throw new Error("Escribe la nota.");
  return withTenant(db, tenant, async (tx) => {
    const [latest] = await conversationsOf(tx, key);
    if (!latest) throw new Error("Esa conversación ya no existe.");
    await tx.insert(messages).values({
      orgId: tenant.orgId,
      conversationId: latest.id,
      direction: "internal",
      channel: "note",
      fromAddress: author,
      body: text.slice(0, 10_000),
      metadata: { userId: tenant.actorId },
    });
    await audit(tx, tenant, {
      event: "conversation.note_added",
      projectId: latest.projectId,
      entityType: "conversation",
      entityId: latest.id,
    });
  });
}

/**
 * A person's reply, sent through the gateway like any agent action (so the
 * project's rules, exclusions and hours apply) and recorded in the thread
 * once sent.
 */
export async function replyToPerson(
  deps: GatewayDeps,
  tenant: TenantContext,
  key: string,
  input: { channel: "email" | "whatsapp"; subject?: string; body: string },
): Promise<string> {
  const person = await getPerson(deps.db, tenant, key, deps.now?.() ?? new Date());
  if (!person?.contact) throw new Error("No sabemos a quién responder en esta conversación.");
  const body = input.body.trim();
  if (!body) throw new Error("Escribe la respuesta.");
  const conv = person.conversations.find((c) => c.channel === input.channel) ?? person.conversations[0];
  const ownIdentity = await withTenant(deps.db, tenant, (tx) =>
    tx
      .select({ id: identities.id, isDefault: projectIdentities.isDefault })
      .from(projectIdentities)
      .innerJoin(identities, eq(identities.id, projectIdentities.identityId))
      .where(and(eq(projectIdentities.projectId, conv.projectId), eq(identities.kind, input.channel))),
  );
  const identity = ownIdentity.sort((a, b) => Number(b.isDefault) - Number(a.isDefault))[0];
  let payload: Record<string, unknown>;
  if (input.channel === "email") {
    if (!person.contact.email || !identity)
      throw new Error("Para responder por email, el proyecto necesita un buzón conectado.");
    const subject =
      input.subject?.trim() ||
      (person.lastSubject
        ? /^re:/i.test(person.lastSubject)
          ? person.lastSubject
          : `Re: ${person.lastSubject}`
        : "") ||
      `Respuesta de ${person.project?.name ?? "nuestro equipo"}`;
    payload = {
      identityId: identity.id,
      to: [person.contact.email],
      cc: [],
      subject,
      body,
      ...(conv.channel === "email" && conv.externalThreadId ? { threadId: conv.externalThreadId } : {}),
    };
  } else {
    if (!person.contact.phone || !identity)
      throw new Error("Para responder por WhatsApp, el proyecto necesita un número de WhatsApp conectado.");
    if (!person.replyChannels.whatsapp?.windowOpen)
      throw new Error(
        "Han pasado más de 24 horas desde su último WhatsApp: WhatsApp solo deja escribirle con una plantilla aprobada. Respóndele por email.",
      );
    payload = { identityId: identity.id, to: person.contact.phone, body };
  }
  const sent = await proposeAction(deps, tenant, {
    projectId: conv.projectId,
    type: input.channel === "email" ? "email.send" : "whatsapp.send",
    payload,
    context: { subjectRef: `conversation:${conv.id}` },
    reason: "Respuesta escrita por una persona del equipo",
    idempotencyKey: `reply:${conv.id}:${Date.now()}`,
  });
  switch (sent.outcome) {
    case "executed":
      return "Enviado.";
    case "pending_approval":
      return "Queda pendiente de aprobación.";
    case "deferred":
      return "Se enviará en el próximo horario permitido del proyecto.";
    case "approved":
      return "Se enviará cuando se reanuden los agentes.";
    case "duplicate":
      return "Ya se había enviado.";
    case "blocked": {
      const why = sent.action.policyResults.filter((p) => p.outcome === "block").map((p) => p.reason);
      throw new Error(`No se ha enviado: ${why.join(" · ") || "lo impiden las reglas del proyecto."}`);
    }
    default:
      throw new Error(
        sent.action.error ? describeConnectorError(sent.action.error) : "No se ha podido enviar.",
      );
  }
}
