import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import { scriptedLlm } from "../../../tests/helpers/fake-llm";
import { mockFetch, type RecordedRequest } from "../../../tests/helpers/fetch";
import { ConnectorExecutor } from "../connectors/executor";
import { createGoogleClient, googleProvider, meetCodeOf } from "../connectors/google";
import { saveGoogleConnection, setProjectIdentity } from "../connectors/service";
import type { Db } from "../db/client";
import { contacts, conversations, identities, meetings, messages, projects } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { proposeAction } from "../gateway/gateway";
import {
  importMeetTranscript,
  recordBookedMeeting,
  retryMeetingTranscript,
  syncPendingTranscripts,
} from "./service";

const RECORD = "conferenceRecords/rec-1";
const TRANSCRIPT = `${RECORD}/transcripts/tr-1`;

/** A Meet API double: one call with a two-page transcript, or the given state. */
function meetApi(
  state: { record?: "none" | "running" | "ended"; transcript?: "none" | "started" | "ended" } = {},
) {
  const record = state.record ?? "ended";
  const transcript = state.transcript ?? "ended";
  return {
    "GET https://meet.googleapis.com/v2/conferenceRecords?": () => ({
      conferenceRecords:
        record === "none"
          ? []
          : [
              {
                name: RECORD,
                startTime: "2026-10-09T09:02:00Z",
                ...(record === "ended" ? { endTime: "2026-10-09T09:31:00Z" } : {}),
              },
            ],
    }),
    [`GET https://meet.googleapis.com/v2/${RECORD}/transcripts`]: () => ({
      transcripts:
        transcript === "none"
          ? []
          : [
              {
                name: TRANSCRIPT,
                state: transcript === "started" ? "STARTED" : "FILE_GENERATED",
                docsDestination: { exportUri: "https://docs.google.com/document/d/TR/export" },
              },
            ],
    }),
    [`GET https://meet.googleapis.com/v2/${RECORD}/participants`]: () => ({
      participants: [
        { name: `${RECORD}/participants/p1`, signedinUser: { displayName: "Fredi" } },
        { name: `${RECORD}/participants/p2`, anonymousUser: { displayName: "Ana Ruiz" } },
      ],
    }),
    [`GET https://meet.googleapis.com/v2/${TRANSCRIPT}/entries`]: (req: RecordedRequest) =>
      new URL(req.url).searchParams.get("pageToken") === "next"
        ? {
            transcriptEntries: [
              {
                participant: `${RECORD}/participants/p1`,
                text: "Te mando la propuesta el lunes.",
                startTime: "2026-10-09T09:20:00Z",
              },
            ],
          }
        : {
            transcriptEntries: [
              {
                participant: `${RECORD}/participants/p1`,
                text: "Hola Ana, ¿qué necesitáis?",
                startTime: "2026-10-09T09:03:00Z",
              },
              {
                participant: `${RECORD}/participants/p2`,
                text: "Gestionar 40 transferencias al mes.",
                startTime: "2026-10-09T09:04:00Z",
              },
              { participant: `${RECORD}/participants/p9`, text: " ", startTime: "2026-10-09T09:05:00Z" },
            ],
            nextPageToken: "next",
          },
  };
}

const oauth = { clientId: "cid", clientSecret: "secret" };
const creds = { refreshToken: "r", accessToken: "tok", expiresAt: Date.now() + 3_600_000, scope: "" };
const window = { meetCode: "abc-defg-hij", from: "2026-10-09T07:00:00Z", to: "2026-10-09T12:00:00Z" };

describe("Meet transcripts in the Google connector", () => {
  it("reads the codes of Meet links", () => {
    expect(meetCodeOf("https://meet.google.com/abc-defg-hij?authuser=0")).toBe("abc-defg-hij");
    expect(meetCodeOf(" ABC-DEFG-HIJ ")).toBe("abc-defg-hij");
    expect(meetCodeOf("https://zoom.us/j/123")).toBeNull();
    expect(meetCodeOf(null)).toBeNull();
  });

  it("joins every page of the transcript with the participants' names", async () => {
    const { fetch, requests } = mockFetch(meetApi());
    const found = await createGoogleClient(creds, { fetch, oauth })["meet.transcript"](window);
    expect(found).toEqual({
      status: "ready",
      docUrl: "https://docs.google.com/document/d/TR/export",
      lines: [
        { speaker: "Fredi", text: "Hola Ana, ¿qué necesitáis?", at: "2026-10-09T09:03:00Z" },
        { speaker: "Ana Ruiz", text: "Gestionar 40 transferencias al mes.", at: "2026-10-09T09:04:00Z" },
        { speaker: "Fredi", text: "Te mando la propuesta el lunes.", at: "2026-10-09T09:20:00Z" },
      ],
    });
    expect(new URL(requests[0].url).searchParams.get("filter")).toBe(
      'space.meeting_code = "abc-defg-hij" AND start_time >= "2026-10-09T07:00:00Z" AND start_time <= "2026-10-09T12:00:00Z"',
    );
    expect(requests[0].headers.authorization).toBe("Bearer tok");
  });

  it("tells a call not held, still going, or without transcript", async () => {
    const read = (state: Parameters<typeof meetApi>[0]) =>
      createGoogleClient(creds, { fetch: mockFetch(meetApi(state)).fetch, oauth })["meet.transcript"](window);
    expect(await read({ record: "none" })).toEqual({ status: "not_found" });
    expect(await read({ record: "running" })).toEqual({ status: "in_progress" });
    expect(await read({ transcript: "started" })).toEqual({ status: "in_progress" });
    expect(await read({ transcript: "none" })).toEqual({ status: "none" });
  });

  it("is granted by the Meet permission", () => {
    expect(googleProvider(oauth).capabilitiesFor({ read: ["meet"], write: [] })).toEqual(["meet.transcript"]);
  });
});

describe("meetings booked by the agents", () => {
  let db: Db;
  let close: () => Promise<void>;
  let tenant: TenantContext;
  let projectId: string;
  let conversationId: string;
  let calendarId: string;
  let state: Parameters<typeof meetApi>[0] = { record: "none" };

  const google = googleProvider(oauth);
  const providers = () => google as never;
  // Calendar booking plus the Meet API, whose answers change with `state`.
  const fetch = (async (input: string | URL | Request, init?: RequestInit) =>
    mockFetch({
      "POST https://www.googleapis.com/calendar/v3/calendars/": () => ({
        id: "ev1",
        htmlLink: "https://calendar.google.com/ev1",
        hangoutLink: "https://meet.google.com/abc-defg-hij",
      }),
      ...meetApi(state),
    }).fetch(input, init)) as typeof globalThis.fetch;
  const deps = (now: string, llm?: ReturnType<typeof scriptedLlm>["llm"]) => ({
    db,
    connectors: { fetch, providers },
    llmFor: async () => llm ?? null,
    now: () => new Date(now),
  });

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    const seeded = await seedOrg(db, "Meet");
    tenant = { orgId: seeded.orgId, actorType: "user", actorId: seeded.userId };
    const scope = [
      "https://www.googleapis.com/auth/calendar.freebusy",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/meetings.space.readonly",
    ].join(" ");
    const conn = await saveGoogleConnection({ db }, tenant, {
      email: "yo@acme.com",
      name: "Yo",
      ownerUserId: seeded.userId,
      credentials: { ...creds, scope },
    });
    expect(conn.readScopes).toContain("meet");
    ({ projectId, conversationId, calendarId } = await withTenant(db, tenant, async (tx) => {
      const [p] = await tx.insert(projects).values({ orgId: tenant.orgId, name: "Gestoría" }).returning();
      const [contact] = await tx
        .insert(contacts)
        .values({ orgId: tenant.orgId, projectId: p.id, email: "ana@cliente.com", firstName: "Ana" })
        .returning();
      const [c] = await tx
        .insert(conversations)
        .values({ orgId: tenant.orgId, projectId: p.id, contactId: contact.id, channel: "email" })
        .returning();
      const [calendar] = await tx
        .select()
        .from(identities)
        .where(eq(identities.address, "yo@acme.com"))
        .then((rows) => rows.filter((r) => r.kind === "calendar"));
      return { projectId: p.id, conversationId: c.id, calendarId: calendar.id };
    }));
    await setProjectIdentity({ db }, tenant, { projectId, identityId: calendarId, assigned: true });
  });
  afterAll(async () => close());

  it("keeps a booked Meet call and, once it ends, brings its transcript, summary and next steps to the conversation", async () => {
    const booked = await proposeAction(
      {
        db,
        executor: new ConnectorExecutor({ db, fetch, providers }),
        now: () => new Date("2026-10-07T09:00:00Z"),
        afterExecute: ({ orgId, action }) => recordBookedMeeting(db, orgId, action),
      },
      tenant,
      {
        projectId,
        type: "calendar.book",
        payload: {
          identityId: calendarId,
          start: "2026-10-09T09:00:00Z",
          end: "2026-10-09T09:30:00Z",
          title: "Demo con Ana",
          attendees: [{ email: "ana@cliente.com", name: "Ana Ruiz" }],
        },
        context: { subjectRef: `conversation:${conversationId}` },
      },
    );
    expect(booked.outcome).toBe("executed");
    const [meeting] = await withTenant(db, tenant, (tx) => tx.select().from(meetings));
    expect(meeting).toMatchObject({
      meetCode: "abc-defg-hij",
      conversationId,
      calendarEventId: "ev1",
      transcriptStatus: "waiting",
    });

    // Before the call ends, nothing is looked up.
    expect(await syncPendingTranscripts(deps("2026-10-09T09:20:00Z"))).toEqual([]);
    // Ended, but nobody has joined yet: it keeps waiting.
    expect(await syncPendingTranscripts(deps("2026-10-09T09:40:00Z"))).toEqual([
      { meetingId: meeting.id, status: "waiting" },
    ]);
    // Checked a minute ago: not again yet.
    expect(await syncPendingTranscripts(deps("2026-10-09T09:41:00Z"))).toEqual([]);

    state = {};
    const { llm, requests } = scriptedLlm([
      {
        blocks: [
          {
            type: "text",
            text: JSON.stringify({
              summary: "Ana necesita gestionar 40 transferencias al mes.",
              nextSteps: ["Enviar la propuesta el lunes (Fredi)"],
            }),
          },
        ],
      },
    ]);
    expect(await syncPendingTranscripts(deps("2026-10-09T10:00:00Z", llm))).toEqual([
      { meetingId: meeting.id, status: "ready" },
    ]);
    expect(JSON.stringify(requests[0].messages)).toContain("Ana Ruiz: Gestionar 40 transferencias al mes.");

    const [done] = await withTenant(db, tenant, (tx) =>
      tx.select().from(meetings).where(eq(meetings.id, meeting.id)),
    );
    expect(done).toMatchObject({
      transcriptStatus: "ready",
      summary: "Ana necesita gestionar 40 transferencias al mes.",
      nextSteps: ["Enviar la propuesta el lunes (Fredi)"],
      transcriptDocUrl: "https://docs.google.com/document/d/TR/export",
    });
    expect(done.transcript).toHaveLength(3);
    const [note] = await withTenant(db, tenant, (tx) =>
      tx.select().from(messages).where(eq(messages.conversationId, conversationId)),
    );
    expect(note).toMatchObject({ direction: "internal", channel: "meet", subject: "Reunión: Demo con Ana" });
    expect(note.body).toContain("- Enviar la propuesta el lunes (Fredi)");
    const [conversation] = await withTenant(db, tenant, (tx) =>
      tx.select().from(conversations).where(eq(conversations.id, conversationId)),
    );
    expect(conversation.nextStep).toBe("Enviar la propuesta el lunes (Fredi)");
  });

  it("gives up when the call ended without a transcript, and can look again by hand", async () => {
    const [m] = await withTenant(db, tenant, (tx) =>
      tx
        .insert(meetings)
        .values({
          orgId: tenant.orgId,
          projectId,
          meetCode: "abc-defg-hij",
          title: "Seguimiento",
          startAt: new Date("2026-10-09T09:00:00Z"),
          endAt: new Date("2026-10-09T09:30:00Z"),
        })
        .returning(),
    );
    state = { transcript: "none" };
    // Right after the call it may still start late: keep waiting.
    expect(await syncPendingTranscripts(deps("2026-10-09T09:40:00Z"))).toEqual([
      { meetingId: m.id, status: "waiting" },
    ]);
    expect(await syncPendingTranscripts(deps("2026-10-09T12:00:00Z"))).toEqual([
      { meetingId: m.id, status: "none" },
    ]);
    const [after] = await withTenant(db, tenant, (tx) =>
      tx.select().from(meetings).where(eq(meetings.id, m.id)),
    );
    expect(after.lastError).toContain("hay que activarla en Meet");

    state = {};
    const retried = await retryMeetingTranscript(deps("2026-10-09T12:05:00Z"), tenant, m.id);
    expect(retried.transcriptStatus).toBe("ready");
    // Without AI: kept, unsummarised.
    expect(retried.summary).toBeNull();
  });

  it("brings the transcript of a call by its link", async () => {
    state = {};
    const meeting = await importMeetTranscript(deps("2026-10-10T08:00:00Z"), tenant, {
      projectId,
      url: "https://meet.google.com/abc-defg-hij",
    });
    expect(meeting).toMatchObject({ title: "Llamada abc-defg-hij", transcriptStatus: "ready" });
    // Dated by the call, not by the import.
    expect(meeting.startAt.toISOString()).toBe("2026-10-09T09:03:00.000Z");

    state = { record: "running" };
    await expect(
      importMeetTranscript(deps("2026-10-10T08:00:00Z"), tenant, { projectId, url: "abc-defg-hij" }),
    ).rejects.toThrow("aún no han terminado");
    await expect(
      importMeetTranscript(deps("2026-10-10T08:00:00Z"), tenant, { projectId, url: "https://zoom.us/j/1" }),
    ).rejects.toThrow("Pega el enlace");
  });
});
