import type { z } from "zod";

/**
 * Capability contracts. Agents and the gateway speak in capabilities; each
 * connector implements the subset its tool supports.
 */

export type CrmPerson = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  companyId: string | null;
};

export type CrmObjectInfo = {
  name: string;
  labelSingular: string;
  labelPlural: string;
  description: string | null;
  custom: boolean;
};

export type BusyInterval = { start: string; end: string };

export type Capabilities = {
  "crm.search_people": (input: { query?: string; email?: string; limit?: number }) => Promise<CrmPerson[]>;
  "crm.describe": () => Promise<CrmObjectInfo[]>;
  "crm.upsert_contact": (input: {
    email?: string;
    firstName: string;
    lastName: string;
    phone?: string;
    jobTitle?: string;
    companyName?: string;
  }) => Promise<{ id: string; created: boolean }>;
  "crm.create_task": (input: {
    title: string;
    body: string;
    dueAt?: string;
    personExternalId?: string;
  }) => Promise<{ id: string }>;
  "crm.log_note": (input: {
    title: string;
    body: string;
    personExternalId?: string;
  }) => Promise<{ id: string }>;
  "email.send": (input: OutgoingEmail) => Promise<{ messageId: string; threadId: string | null }>;
  "email.create_draft": (input: OutgoingEmail) => Promise<{ draftId: string }>;
  "calendar.free_busy": (input: {
    calendarIds: string[];
    timeMin: string;
    timeMax: string;
  }) => Promise<{ busy: BusyInterval[]; errors: string[] }>;
  "calendar.book": (input: {
    calendarId: string;
    start: string;
    end: string;
    title: string;
    description: string;
    location?: string;
    attendees: { email: string; name?: string }[];
  }) => Promise<{ eventId: string; htmlLink: string | null }>;
};

export type Capability = keyof Capabilities;

export type OutgoingEmail = {
  from: { address: string; name?: string | null };
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  threadId?: string;
  inReplyToMessageId?: string;
};

export type ConnectorClient = Partial<Capabilities>;

export type ConnectorContext = {
  fetch: typeof fetch;
  /** Called when the connector refreshed its credentials (e.g. a new OAuth access token). */
  onCredentialsUpdated?: (credentials: unknown) => Promise<void>;
};

export type ConnectorProvider<Creds> = {
  id: string;
  name: string;
  transport: "api" | "mcp";
  credentialsSchema: z.ZodType<Creds>;
  /** Capabilities granted by the stored scopes. */
  capabilitiesFor(scopes: { read: string[]; write: string[] }): Capability[];
  create(credentials: Creds, ctx: ConnectorContext): ConnectorClient;
};

export class ConnectorError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

export async function expectOk(res: Response, what: string): Promise<unknown> {
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // keep raw text
  }
  if (!res.ok) {
    throw new ConnectorError(`${what} failed with HTTP ${res.status}`, res.status, body);
  }
  return body;
}
