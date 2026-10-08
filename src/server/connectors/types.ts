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

/** A person from a B2B data provider (Apollo, Lusha). Only professional contact data. */
export type DataPerson = {
  /** The provider's id, to enrich the person later. */
  id: string | null;
  name: string;
  title: string | null;
  /** Work email, when the provider has it (search results never include it). */
  email: string | null;
  /** Phones the provider has, without the ones marked «do not call». */
  phones: string[];
  linkedinUrl: string | null;
  city: string | null;
  country: string | null;
  companyName: string | null;
  companyDomain: string | null;
  /** Page of the record in the provider, to cite as the source of the data. */
  sourceUrl: string;
};

/** A company from a B2B data provider. */
export type DataCompany = {
  id: string | null;
  name: string;
  domain: string | null;
  website: string | null;
  phone: string | null;
  industry: string | null;
  employees: number | null;
  city: string | null;
  country: string | null;
  linkedinUrl: string | null;
  description: string | null;
  sourceUrl: string;
};

export type PeopleSearch = {
  titles?: string[];
  keywords?: string;
  /** Where the people are: cities, regions or countries. */
  locations?: string[];
  companyDomains?: string[];
  companyLocations?: string[];
  /** Employee ranges as "min,max", e.g. "11,50". */
  employeeRanges?: string[];
  limit?: number;
};

export type CompanySearch = {
  name?: string;
  keywords?: string[];
  locations?: string[];
  employeeRanges?: string[];
  limit?: number;
};

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
  "email.list_messages": (input: {
    query: string;
    maxResults?: number;
  }) => Promise<{ id: string; threadId: string }[]>;
  "email.get_message": (input: { id: string }) => Promise<IncomingEmail>;
  "email.send": (input: OutgoingEmail) => Promise<{ messageId: string; threadId: string | null }>;
  "email.create_draft": (input: OutgoingEmail) => Promise<{ draftId: string }>;
  "calendar.free_busy": (input: {
    calendarIds: string[];
    timeMin: string;
    timeMax: string;
  }) => Promise<{ busy: BusyInterval[]; errors: string[] }>;
  /** Finds people by title, company and place, without contact details. */
  "data.search_people": (input: PeopleSearch) => Promise<DataPerson[]>;
  /** Finds companies by name, keywords, place and size. */
  "data.search_companies": (input: CompanySearch) => Promise<DataCompany[]>;
  /** Contact details of one person (spends the provider's credits). */
  "data.enrich_person": (input: {
    name?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    companyName?: string;
    companyDomain?: string;
    linkedinUrl?: string;
    providerId?: string;
  }) => Promise<DataPerson | null>;
  /** Details of one company by its domain (spends the provider's credits). */
  "data.enrich_company": (input: { domain?: string; name?: string }) => Promise<DataCompany | null>;
  /** Checks the key, and the credits left when the provider says. */
  "data.check": () => Promise<{ ok: true; detail: string }>;
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

export type IncomingEmail = {
  messageId: string;
  threadId: string;
  /** RFC 822 Message-ID header, used for In-Reply-To when answering. */
  rfcMessageId: string | null;
  from: { email: string; name: string | null };
  to: string[];
  subject: string;
  text: string;
  date: string | null;
  /** Auto-Submitted / bulk headers present (auto-replies, newsletters). */
  autoSubmitted: boolean;
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
