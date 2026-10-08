import { and, asc, desc, eq, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import { audit } from "../audit";
import { meetCodeOf } from "../connectors/google";
import { connectionCapabilities, openConnection, type ConnectorDeps } from "../connectors/service";
import { ConnectorError, describeConnectorError, type MeetTranscript } from "../connectors/types";
import type { Db } from "../db/client";
import {
  connections,
  conversations,
  identities,
  meetings,
  messages,
  projects,
  type TranscriptLine,
} from "../db/schema";
import { withSystem, withTenant, type TenantContext } from "../db/tenant";
import type { CalendarBookPayload } from "../gateway/definitions";
import type { ActionRow } from "../gateway/gateway";
import type { LlmClient } from "../llm/client";

/**
 * Meetings the agents book, and the transcript of their Google Meet call:
 * after the call ends it is read through the organizer's Google connection,
 * summarised by the organization's AI and noted in the contact's
 * conversation. A transcript only exists if someone turned transcription on
 * in the call (Google Workspace plans that include it).
 */

export type MeetingRow = typeof meetings.$inferSelect;

export type MeetingDeps = {
  db: Db;
  connectors?: Omit<ConnectorDeps, "db">;
  /** The organization's AI, to summarise; without it the transcript is kept unsummarised. */
  llmFor?: (orgId: string) => Promise<LlmClient | null>;
  now?: () => Date;
};

const MINUTE = 60_000;
/** Meet takes a few minutes to finish the transcript after the call. */
const FIRST_CHECK_AFTER = 5 * MINUTE;
const RECHECK_EVERY = 10 * MINUTE;
/** A call can overrun or start late: «no transcript» is only final after this. */
const SETTLE_AFTER = 2 * 60 * MINUTE;
const GIVE_UP_AFTER = 48 * 60 * MINUTE;
/** Of transcript text sent to the AI (a long call is ~60k characters an hour). */
const SUMMARY_INPUT_CHARS = 120_000;

function conversationIdOf(action: ActionRow): string | null {
  const ref = action.context.subjectRef;
  return ref?.startsWith("conversation:") ? ref.slice("conversation:".length) : null;
}

/** Called after an action executes: a booked meeting is kept to read its transcript later. */
export async function recordBookedMeeting(db: Db, orgId: string, action: ActionRow) {
  if (action.type !== "calendar.book" || !action.projectId) return;
  const p = action.payload as CalendarBookPayload;
  const result = (action.result ?? {}) as { eventId?: string; meetLink?: string | null };
  const meetCode = meetCodeOf(result.meetLink);
  await withTenant(db, { orgId }, async (tx) => {
    const [identity] = await tx
      .select({ connectionId: identities.connectionId })
      .from(identities)
      .where(eq(identities.id, p.identityId));
    await tx
      .insert(meetings)
      .values({
        orgId,
        projectId: action.projectId!,
        actionId: action.id,
        conversationId: conversationIdOf(action),
        connectionId: identity?.connectionId ?? null,
        calendarEventId: result.eventId ?? null,
        meetCode,
        title: p.title,
        startAt: new Date(p.start),
        endAt: new Date(p.end),
        attendees: p.attendees,
        // Without a Meet call (an address, a phone call) there is nothing to read.
        transcriptStatus: meetCode ? "waiting" : "manual",
        createdBy: action.actorId,
      })
      .onConflictDoNothing();
  });
}

/** The Google connections that may read the transcript, the meeting's own first. */
async function meetConnections(db: Db, tenant: Pick<TenantContext, "orgId">, preferred: string | null) {
  const rows = await withTenant(db, tenant, (tx) =>
    tx.select().from(connections).where(eq(connections.provider, "google")),
  );
  return rows
    .filter((c) => c.status === "active" && connectionCapabilities(c).includes("meet.transcript"))
    .sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred));
}

/** Reads the transcript with the first account that can see the call. */
async function fetchTranscript(
  deps: MeetingDeps,
  tenant: Pick<TenantContext, "orgId">,
  input: { connectionId: string | null; meetCode: string; from: Date; to: Date },
): Promise<MeetTranscript & { connectionId?: string }> {
  const candidates = await meetConnections(deps.db, tenant, input.connectionId);
  if (!candidates.length) {
    throw new Error(
      "Ninguna cuenta de Google tiene permiso para leer transcripciones de Meet: conecta Google Meet en Configuración → Conexiones.",
    );
  }
  let best: MeetTranscript = { status: "not_found" };
  let denied: unknown = null;
  for (const conn of candidates) {
    try {
      const { client } = await openConnection({ db: deps.db, ...deps.connectors }, tenant, conn.id);
      const found = await client["meet.transcript"]!({
        meetCode: input.meetCode,
        from: input.from.toISOString(),
        to: input.to.toISOString(),
      });
      if (found.status === "ready") return { ...found, connectionId: conn.id };
      // Another account may see more (the call, or its transcript).
      if (best.status === "not_found") best = found;
    } catch (err) {
      if (err instanceof ConnectorError && (err.status === 403 || err.status === 404)) {
        denied = err;
        continue;
      }
      throw err;
    }
  }
  if (best.status === "not_found" && denied) throw denied;
  return best;
}

const summaryOutput = z.object({
  summary: z.string(),
  nextSteps: z.array(z.string()).max(8),
});

const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "Qué se habló y en qué quedó, en 3-6 frases." },
    nextSteps: {
      type: "array",
      items: { type: "string" },
      description: "Siguientes pasos acordados, con quién los hace y cuándo si se dijo.",
    },
  },
  required: ["summary", "nextSteps"],
  additionalProperties: false,
} as const;

export function transcriptText(lines: TranscriptLine[]): string {
  return lines.map((l) => `${l.speaker}: ${l.text}`).join("\n");
}

async function summarise(
  llm: LlmClient,
  input: {
    project: string;
    title: string;
    attendees: { email: string; name?: string }[];
    lines: TranscriptLine[];
  },
) {
  let text = transcriptText(input.lines);
  if (text.length > SUMMARY_INPUT_CHARS)
    text = `${text.slice(0, SUMMARY_INPUT_CHARS)}\n[…transcripción recortada]`;
  const response = await llm.create({
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: [
          `Resume para el equipo de ventas de «${input.project}» esta reunión con un cliente o posible cliente.`,
          `Reunión: ${input.title}`,
          input.attendees.length
            ? `Invitados: ${input.attendees.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(", ")}`
            : "",
          "Cuenta qué necesita el cliente, objeciones, precios o condiciones mencionados y en qué se quedó. Los siguientes pasos solo si se acordaron. Solo lo que se dijo, sin inventar. En español.",
          `## Transcripción\n${text}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    output_config: { effort: "low", format: { type: "json_schema", schema: SUMMARY_SCHEMA } },
  });
  if (response.stop_reason === "refusal") return null;
  const raw = response.content
    .filter((b): b is Extract<(typeof response.content)[number], { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
  const parsed = summaryOutput.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}

/** Keeps a read transcript: summary, next steps and a note in the conversation. */
async function saveTranscript(
  deps: MeetingDeps,
  tenant: TenantContext,
  meeting: MeetingRow,
  found: Extract<MeetTranscript, { status: "ready" }> & { connectionId?: string },
) {
  const llm = deps.llmFor ? await deps.llmFor(tenant.orgId).catch(() => null) : null;
  const [project] = await withTenant(deps.db, tenant, (tx) =>
    tx.select({ name: projects.name }).from(projects).where(eq(projects.id, meeting.projectId)),
  );
  let summary: { summary: string; nextSteps: string[] } | null = null;
  let summaryError: string | null = null;
  if (llm) {
    try {
      summary = await summarise(llm, {
        project: project?.name ?? "",
        title: meeting.title,
        attendees: meeting.attendees,
        lines: found.lines,
      });
    } catch (err) {
      console.error("meeting summary failed", err);
      summaryError = "La transcripción está, pero no se ha podido resumir con la IA.";
    }
  }
  const times = found.lines.map((l) => l.at).filter((t): t is string => Boolean(t));
  return withTenant(deps.db, tenant, async (tx) => {
    const [row] = await tx
      .update(meetings)
      .set({
        transcriptStatus: "ready",
        transcript: found.lines,
        transcriptDocUrl: found.docUrl,
        summary: summary?.summary ?? null,
        nextSteps: summary?.nextSteps ?? [],
        connectionId: found.connectionId ?? meeting.connectionId,
        checkedAt: deps.now?.() ?? new Date(),
        lastError: summaryError,
        // Added by hand: the call's real time.
        ...(meeting.actionId || !times.length
          ? {}
          : { startAt: new Date(times[0]), endAt: new Date(times[times.length - 1]) }),
      })
      .where(eq(meetings.id, meeting.id))
      .returning();
    if (meeting.conversationId) {
      const steps = summary?.nextSteps ?? [];
      await tx
        .insert(messages)
        .values({
          orgId: tenant.orgId,
          conversationId: meeting.conversationId,
          direction: "internal",
          channel: "meet",
          externalId: `meeting:${meeting.id}`,
          subject: `Reunión: ${meeting.title}`,
          body: [
            summary?.summary ?? "La transcripción de la reunión ya está disponible.",
            steps.length ? `Siguientes pasos:\n${steps.map((s) => `- ${s}`).join("\n")}` : "",
          ]
            .filter(Boolean)
            .join("\n\n"),
          metadata: { meetingId: meeting.id },
        })
        .onConflictDoNothing();
      if (steps.length) {
        await tx
          .update(conversations)
          .set({ nextStep: steps.join(" · ").slice(0, 1000) })
          .where(eq(conversations.id, meeting.conversationId));
      }
    }
    await audit(tx, tenant, {
      event: "meeting.transcribed",
      projectId: meeting.projectId,
      entityType: "meeting",
      entityId: meeting.id,
      data: { lines: found.lines.length, summarised: Boolean(summary) },
    });
    return row;
  });
}

/**
 * Looks for a meeting's transcript once. Not there yet: it stays waiting
 * until the call has surely ended; then «none».
 */
export async function syncMeetingTranscript(
  deps: MeetingDeps,
  tenant: TenantContext,
  meeting: MeetingRow,
): Promise<MeetingRow> {
  const now = deps.now?.() ?? new Date();
  const update = async (values: Partial<MeetingRow>) => {
    const [row] = await withTenant(deps.db, tenant, (tx) =>
      tx
        .update(meetings)
        .set({ checkedAt: now, ...values })
        .where(eq(meetings.id, meeting.id))
        .returning(),
    );
    return row;
  };
  if (!meeting.meetCode) return update({ transcriptStatus: "manual" });

  let found: Awaited<ReturnType<typeof fetchTranscript>>;
  try {
    found = await fetchTranscript(deps, tenant, {
      connectionId: meeting.connectionId,
      meetCode: meeting.meetCode,
      from: new Date(meeting.startAt.getTime() - SETTLE_AFTER),
      to: new Date(meeting.endAt.getTime() + SETTLE_AFTER),
    });
  } catch (err) {
    const message =
      err instanceof ConnectorError
        ? describeConnectorError(err)
        : err instanceof Error
          ? err.message
          : String(err);
    return update({ transcriptStatus: "error", lastError: message });
  }
  if (found.status === "ready") return saveTranscript(deps, tenant, meeting, found);

  const since = now.getTime() - meeting.endAt.getTime();
  if (found.status === "none" && since > SETTLE_AFTER) {
    return update({
      transcriptStatus: "none",
      lastError:
        "La llamada terminó sin transcripción: hay que activarla en Meet (Actividades → Transcripciones).",
    });
  }
  if (since > GIVE_UP_AFTER) {
    return update({
      transcriptStatus: "none",
      lastError:
        found.status === "not_found"
          ? "No hubo llamada de Meet con ese enlace."
          : "Meet no ha terminado la transcripción en 48 horas.",
    });
  }
  return update({ transcriptStatus: "waiting", lastError: null });
}

/** Meetings whose call has ended and whose transcript is due a look (the scheduler calls this). */
export async function syncPendingTranscripts(deps: MeetingDeps, limit = 5) {
  const now = deps.now?.() ?? new Date();
  const due = await withSystem(deps.db, (tx) =>
    tx
      .select()
      .from(meetings)
      .where(
        and(
          eq(meetings.transcriptStatus, "waiting"),
          lte(meetings.endAt, new Date(now.getTime() - FIRST_CHECK_AFTER)),
          or(isNull(meetings.checkedAt), lte(meetings.checkedAt, new Date(now.getTime() - RECHECK_EVERY))),
        ),
      )
      .orderBy(asc(meetings.endAt))
      .limit(limit),
  );
  const report: { meetingId: string; status: string }[] = [];
  for (const meeting of due) {
    const tenant: TenantContext = { orgId: meeting.orgId, actorType: "system", actorId: "meet-transcripts" };
    try {
      const row = await syncMeetingTranscript(deps, tenant, meeting);
      report.push({ meetingId: meeting.id, status: row.transcriptStatus });
    } catch (err) {
      console.error("transcript sync failed", meeting.id, err);
      report.push({ meetingId: meeting.id, status: "failed" });
    }
  }
  return report;
}

/** A person asks to look again (after turning on the permission, or sooner than the scheduler). */
export async function retryMeetingTranscript(deps: MeetingDeps, tenant: TenantContext, meetingId: string) {
  const meeting = await getMeeting(deps.db, tenant, meetingId);
  if (!meeting) throw new Error("Reunión no encontrada.");
  if (!meeting.meetCode) throw new Error("Esta reunión no fue por Google Meet.");
  return syncMeetingTranscript(deps, tenant, { ...meeting, transcriptStatus: "waiting" });
}

/**
 * Brings the transcript of any Meet call by its link (one the team held
 * outside the agents). Only finished calls with a transcript are added.
 */
export async function importMeetTranscript(
  deps: MeetingDeps,
  tenant: TenantContext,
  input: { projectId: string; url: string; title?: string; conversationId?: string | null },
): Promise<MeetingRow> {
  const meetCode = meetCodeOf(input.url);
  if (!meetCode)
    throw new Error("Pega el enlace de la llamada (https://meet.google.com/abc-defg-hij) o su código.");
  const now = deps.now?.() ?? new Date();
  const found = await fetchTranscript(deps, tenant, {
    connectionId: null,
    meetCode,
    from: new Date(now.getTime() - 30 * 24 * 60 * MINUTE),
    to: now,
  });
  if (found.status !== "ready") {
    throw new Error(
      {
        not_found: "No encontramos esa llamada en los últimos 30 días con las cuentas de Google conectadas.",
        in_progress: "La llamada o su transcripción aún no han terminado. Prueba en unos minutos.",
        none: "Esa llamada no tiene transcripción: hay que activarla en Meet durante la llamada.",
      }[found.status],
    );
  }
  const [created] = await withTenant(deps.db, tenant, (tx) =>
    tx
      .insert(meetings)
      .values({
        orgId: tenant.orgId,
        projectId: input.projectId,
        conversationId: input.conversationId ?? null,
        connectionId: found.connectionId ?? null,
        meetCode,
        title: input.title?.trim() || `Llamada ${meetCode}`,
        startAt: now,
        endAt: now,
        createdBy: tenant.actorId,
      })
      .returning(),
  );
  return saveTranscript(deps, tenant, created, found);
}

export async function getMeeting(db: Db, tenant: Pick<TenantContext, "orgId">, meetingId: string) {
  const [row] = await withTenant(db, tenant, (tx) =>
    tx.select().from(meetings).where(eq(meetings.id, meetingId)),
  );
  return row ?? null;
}

export async function listMeetings(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  filter: { projectId: string } | { conversationId: string },
) {
  return withTenant(db, tenant, (tx) =>
    tx
      .select()
      .from(meetings)
      .where(
        "projectId" in filter
          ? eq(meetings.projectId, filter.projectId)
          : eq(meetings.conversationId, filter.conversationId),
      )
      .orderBy(desc(meetings.startAt))
      .limit(200),
  );
}
