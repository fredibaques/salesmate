import { describe, expect, it } from "vitest";
import { mockFetch } from "../../../tests/helpers/fetch";
import { buildMimeMessage, createGoogleClient, googleAuthUrl, grantedScopeSets } from "./google";

const oauth = { clientId: "cid", clientSecret: "secret" };

describe("Google connector", () => {
  it("builds the consent URL with offline access and the chosen scopes", () => {
    const url = new URL(
      googleAuthUrl(
        { ...oauth, redirectUri: "http://localhost:3000/cb" },
        ["calendar_read", "gmail_write"],
        "st",
      ),
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/calendar.freebusy");
    expect(url.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/gmail.compose");
    expect(url.searchParams.get("state")).toBe("st");
  });

  it("maps granted scopes to scope sets", () => {
    expect(
      grantedScopeSets(
        "openid https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.compose",
      ),
    ).toEqual(["calendar_write", "gmail_write"]);
  });

  it("encodes non-ASCII subjects and names in MIME", () => {
    const mime = buildMimeMessage({
      from: { address: "yo@acme.com", name: "José" },
      to: ["ana@cliente.com"],
      cc: [],
      subject: "Reunión mañana",
      body: "Hola Ana",
    });
    expect(mime).toContain(`Subject: =?UTF-8?B?${Buffer.from("Reunión mañana").toString("base64")}?=`);
    expect(mime).toContain(`From: =?UTF-8?B?${Buffer.from("José").toString("base64")}?= <yo@acme.com>`);
    expect(mime.split("\r\n\r\n")[1]).toBe(Buffer.from("Hola Ana").toString("base64"));
  });

  it("refreshes expired tokens, persists them and sends mail", async () => {
    const { fetch, requests } = mockFetch({
      "POST https://oauth2.googleapis.com/token": () => ({
        access_token: "new-token",
        expires_in: 3600,
        scope: "x",
      }),
      "POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send": () => ({
        id: "m1",
        threadId: "t1",
      }),
    });
    const persisted: unknown[] = [];
    const client = createGoogleClient(
      { refreshToken: "r", accessToken: "old", expiresAt: Date.now() - 1000, scope: "" },
      { fetch, oauth, onCredentialsUpdated: async (c) => void persisted.push(c) },
    );
    const sent = await client["email.send"]({
      from: { address: "yo@acme.com" },
      to: ["ana@cliente.com"],
      cc: [],
      subject: "Hola",
      body: "Qué tal",
    });
    expect(sent).toEqual({ messageId: "m1", threadId: "t1" });
    expect(requests[1].headers.authorization).toBe("Bearer new-token");
    expect(persisted).toHaveLength(1);
    const raw = (requests[1].body as { raw: string }).raw;
    expect(Buffer.from(raw, "base64url").toString()).toContain("To: ana@cliente.com");
  });

  it("reads busy intervals across calendars and reports per-calendar errors", async () => {
    const { fetch } = mockFetch({
      "POST https://www.googleapis.com/calendar/v3/freeBusy": () => ({
        calendars: {
          "a@acme.com": { busy: [{ start: "2026-10-07T09:00:00Z", end: "2026-10-07T10:00:00Z" }] },
          "b@acme.com": { errors: [{ reason: "notFound" }] },
        },
      }),
    });
    const client = createGoogleClient(
      { refreshToken: "r", accessToken: "tok", expiresAt: Date.now() + 3_600_000, scope: "" },
      { fetch, oauth },
    );
    const result = await client["calendar.free_busy"]({
      calendarIds: ["a@acme.com", "b@acme.com"],
      timeMin: "2026-10-07T00:00:00Z",
      timeMax: "2026-10-08T00:00:00Z",
    });
    expect(result.busy).toHaveLength(1);
    expect(result.errors).toEqual(["b@acme.com: notFound"]);
  });
});
