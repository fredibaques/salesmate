import { z } from "zod";
import {
  ConnectorError,
  expectOk,
  type Capability,
  type ConnectorContext,
  type ConnectorProvider,
  type IncomingEmail,
  type OutgoingEmail,
} from "./types";
import { htmlToText } from "../knowledge/documents";

/**
 * Google account connected as a project mailbox/calendar (not the login).
 * Gmail and Calendar are called directly over REST with OAuth tokens.
 */

export const GOOGLE_SCOPE_SETS = {
  calendar_read: ["https://www.googleapis.com/auth/calendar.freebusy"],
  calendar_write: ["https://www.googleapis.com/auth/calendar.events"],
  gmail_write: ["https://www.googleapis.com/auth/gmail.compose"],
  gmail_read: ["https://www.googleapis.com/auth/gmail.readonly"],
} as const;
export type GoogleScopeSet = keyof typeof GOOGLE_SCOPE_SETS;

const BASE_SCOPES = ["openid", "email", "profile"];

export const googleCredentials = z.object({
  refreshToken: z.string(),
  accessToken: z.string().optional(),
  /** epoch millis */
  expiresAt: z.number().optional(),
  scope: z.string().default(""),
});
export type GoogleCredentials = z.infer<typeof googleCredentials>;

export type GoogleOAuthClient = { clientId: string; clientSecret: string; redirectUri: string };

export function googleAuthUrl(
  client: GoogleOAuthClient,
  sets: GoogleScopeSet[],
  state: string,
  loginHint?: string,
) {
  const scopes = [...BASE_SCOPES, ...sets.flatMap((s) => GOOGLE_SCOPE_SETS[s])];
  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  if (loginHint) params.set("login_hint", loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  id_token?: string;
};

export async function exchangeGoogleCode(
  client: GoogleOAuthClient,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ credentials: GoogleCredentials; email: string; name: string | null }> {
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: client.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const token = (await expectOk(res, "Google token exchange")) as TokenResponse;
  if (!token.refresh_token) {
    throw new ConnectorError("Google did not return a refresh token; revoke access and connect again.");
  }
  const info = (await expectOk(
    await fetchImpl("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${token.access_token}` },
    }),
    "Google userinfo",
  )) as { email: string; name?: string };
  return {
    credentials: {
      refreshToken: token.refresh_token,
      accessToken: token.access_token,
      expiresAt: Date.now() + token.expires_in * 1000,
      scope: token.scope,
    },
    email: info.email.toLowerCase(),
    name: info.name ?? null,
  };
}

/** Which scope sets a granted scope string covers. */
export function grantedScopeSets(scope: string): GoogleScopeSet[] {
  const granted = new Set(scope.split(/\s+/));
  return (Object.keys(GOOGLE_SCOPE_SETS) as GoogleScopeSet[]).filter((set) =>
    GOOGLE_SCOPE_SETS[set].every((s) => granted.has(s)),
  );
}

// ---------------------------------------------------------------------------
// MIME
// ---------------------------------------------------------------------------

function encodeHeader(value: string): string {
  // RFC 2047 for non-ASCII header values.
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function formatAddress(address: string, name?: string | null): string {
  return name ? `${encodeHeader(name.replace(/"/g, ""))} <${address}>` : address;
}

export function buildMimeMessage(email: OutgoingEmail): string {
  const headers = [
    `From: ${formatAddress(email.from.address, email.from.name)}`,
    `To: ${email.to.join(", ")}`,
    ...(email.cc.length ? [`Cc: ${email.cc.join(", ")}`] : []),
    `Subject: ${encodeHeader(email.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    ...(email.inReplyToMessageId
      ? [`In-Reply-To: ${email.inReplyToMessageId}`, `References: ${email.inReplyToMessageId}`]
      : []),
  ];
  const body = Buffer.from(email.body, "utf8")
    .toString("base64")
    .replace(/(.{76})/g, "$1\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

type GmailPart = {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
};

function header(part: GmailPart, name: string): string | null {
  return part.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function findBody(part: GmailPart, mime: string): string | null {
  if (part.mimeType === mime && part.body?.data)
    return Buffer.from(part.body.data, "base64url").toString("utf8");
  for (const child of part.parts ?? []) {
    const found = findBody(child, mime);
    if (found) return found;
  }
  return null;
}

/** "Ana López <ana@x.com>" → { email, name } */
export function parseAddress(value: string): { email: string; name: string | null } {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(value);
  if (match) return { email: match[2].trim().toLowerCase(), name: match[1].trim() || null };
  return { email: value.trim().toLowerCase(), name: null };
}

export function parseGmailMessage(message: {
  id: string;
  threadId: string;
  payload: GmailPart;
}): IncomingEmail {
  const p = message.payload;
  const text = findBody(p, "text/plain") ?? htmlToText(findBody(p, "text/html") ?? "");
  const autoHeader = header(p, "Auto-Submitted");
  return {
    messageId: message.id,
    threadId: message.threadId,
    rfcMessageId: header(p, "Message-ID") ?? header(p, "Message-Id"),
    from: parseAddress(header(p, "From") ?? ""),
    to: (header(p, "To") ?? "")
      .split(",")
      .map((v) => parseAddress(v).email)
      .filter(Boolean),
    subject: header(p, "Subject") ?? "",
    text,
    date: header(p, "Date"),
    autoSubmitted:
      (autoHeader !== null && autoHeader.toLowerCase() !== "no") ||
      /^(bulk|list|junk)$/i.test(header(p, "Precedence") ?? "") ||
      header(p, "List-Unsubscribe") !== null,
  };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export function createGoogleClient(
  creds: GoogleCredentials,
  ctx: ConnectorContext & { oauth: Pick<GoogleOAuthClient, "clientId" | "clientSecret"> },
) {
  let current = { ...creds };

  async function accessToken(): Promise<string> {
    if (current.accessToken && current.expiresAt && current.expiresAt - 60_000 > Date.now()) {
      return current.accessToken;
    }
    const res = await ctx.fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: ctx.oauth.clientId,
        client_secret: ctx.oauth.clientSecret,
        refresh_token: current.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const token = (await expectOk(res, "Google token refresh")) as TokenResponse;
    current = {
      ...current,
      accessToken: token.access_token,
      expiresAt: Date.now() + token.expires_in * 1000,
      scope: token.scope ?? current.scope,
    };
    await ctx.onCredentialsUpdated?.(current);
    return current.accessToken!;
  }

  async function call(url: string, init: RequestInit & { json?: unknown } = {}): Promise<unknown> {
    const { json, ...rest } = init;
    const res = await ctx.fetch(url, {
      ...rest,
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...rest.headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
    return expectOk(res, `Google ${rest.method ?? "GET"} ${new URL(url).pathname}`);
  }

  const raw = (email: OutgoingEmail) => Buffer.from(buildMimeMessage(email), "utf8").toString("base64url");

  return {
    async "email.list_messages"({ query, maxResults = 20 }: { query: string; maxResults?: number }) {
      const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
      const res = (await call(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`)) as {
        messages?: { id: string; threadId: string }[];
      };
      return res.messages ?? [];
    },

    async "email.get_message"({ id }: { id: string }) {
      const message = (await call(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
      )) as { id: string; threadId: string; payload: GmailPart };
      return parseGmailMessage(message);
    },

    async "email.send"(email: OutgoingEmail) {
      const sent = (await call("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        json: { raw: raw(email), ...(email.threadId ? { threadId: email.threadId } : {}) },
      })) as { id: string; threadId?: string };
      return { messageId: sent.id, threadId: sent.threadId ?? null };
    },

    async "email.create_draft"(email: OutgoingEmail) {
      const draft = (await call("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
        method: "POST",
        json: { message: { raw: raw(email), ...(email.threadId ? { threadId: email.threadId } : {}) } },
      })) as { id: string };
      return { draftId: draft.id };
    },

    async "calendar.free_busy"(input: { calendarIds: string[]; timeMin: string; timeMax: string }) {
      const res = (await call("https://www.googleapis.com/calendar/v3/freeBusy", {
        method: "POST",
        json: {
          timeMin: input.timeMin,
          timeMax: input.timeMax,
          items: input.calendarIds.map((id) => ({ id })),
        },
      })) as {
        calendars: Record<string, { busy?: { start: string; end: string }[]; errors?: { reason: string }[] }>;
      };
      const busy = Object.values(res.calendars).flatMap((c) => c.busy ?? []);
      const errors = Object.entries(res.calendars).flatMap(([id, c]) =>
        (c.errors ?? []).map((e) => `${id}: ${e.reason}`),
      );
      return { busy, errors };
    },

    async "calendar.book"(input: {
      calendarId: string;
      start: string;
      end: string;
      title: string;
      description: string;
      location?: string;
      attendees: { email: string; name?: string }[];
    }) {
      const event = (await call(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events?sendUpdates=all`,
        {
          method: "POST",
          json: {
            summary: input.title,
            description: input.description,
            location: input.location,
            start: { dateTime: input.start },
            end: { dateTime: input.end },
            attendees: input.attendees.map((a) => ({ email: a.email, displayName: a.name })),
          },
        },
      )) as { id: string; htmlLink?: string };
      return { eventId: event.id, htmlLink: event.htmlLink ?? null };
    },
  };
}

export function googleProvider(
  oauth: Pick<GoogleOAuthClient, "clientId" | "clientSecret">,
): ConnectorProvider<GoogleCredentials> {
  return {
    id: "google",
    name: "Google (Gmail + Calendar)",
    transport: "api",
    credentialsSchema: googleCredentials,
    capabilitiesFor({ read, write }) {
      const caps: Capability[] = [];
      if (read.includes("calendar")) caps.push("calendar.free_busy");
      if (write.includes("calendar")) caps.push("calendar.book");
      if (read.includes("email")) caps.push("email.list_messages", "email.get_message");
      if (write.includes("email")) caps.push("email.create_draft", "email.send");
      return caps;
    },
    create: (creds, ctx) => createGoogleClient(creds, { ...ctx, oauth }),
  };
}
