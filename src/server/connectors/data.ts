import { z } from "zod";
import {
  ConnectorError,
  expectOk,
  type Capability,
  type CompanySearch,
  type ConnectorContext,
  type ConnectorProvider,
  type DataCompany,
  type DataPerson,
  type PeopleSearch,
} from "./types";

/**
 * B2B data providers: they find companies and the people who work there,
 * and give their professional contact details. Only reading; enriching
 * spends the provider's credits, searching people in Apollo doesn't.
 *
 * - Apollo: https://api.apollo.io/api/v1 with the `x-api-key` header.
 * - Lusha (v2 API): https://api.lusha.com with the `api_key` header.
 */

export const dataCredentials = z.object({
  apiKey: z.string().trim().min(10, "La API key no parece válida."),
});
export type DataCredentials = z.infer<typeof dataCredentials>;

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const clampLimit = (n: number | undefined, max: number) => Math.max(1, Math.min(n ?? 10, max));

/** «https://www.example.com/x» → «example.com». */
function domainOf(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Query string with Rails-style arrays (`key[]=a&key[]=b`), as Apollo expects. */
function query(params: Record<string, string | number | boolean | string[] | undefined>) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    if (Array.isArray(value)) value.filter(Boolean).forEach((v) => qs.append(`${key}[]`, v));
    else qs.set(key, String(value));
  }
  return qs.toString();
}

// ---------------------------------------------------------------------------
// Apollo
// ---------------------------------------------------------------------------

type ApolloOrg = Record<string, unknown> & { id?: string; name?: string };
type ApolloPerson = Record<string, unknown> & {
  id?: string;
  organization?: ApolloOrg | null;
  contact?: { phone_numbers?: { sanitized_number?: string; raw_number?: string }[] } | null;
  phone_numbers?: { sanitized_number?: string; raw_number?: string }[];
};

function apolloCompany(o: ApolloOrg): DataCompany {
  const id = str(o.id);
  return {
    id,
    name: str(o.name) ?? "",
    domain: str(o.primary_domain) ?? domainOf(o.website_url),
    website: str(o.website_url),
    phone: str((o.primary_phone as { number?: string } | undefined)?.number) ?? str(o.phone),
    industry: str(o.industry),
    employees: typeof o.estimated_num_employees === "number" ? o.estimated_num_employees : null,
    city: str(o.city),
    country: str(o.country),
    linkedinUrl: str(o.linkedin_url),
    description: str(o.short_description),
    sourceUrl: id ? `https://app.apollo.io/#/organizations/${id}` : "https://app.apollo.io",
  };
}

function apolloPerson(p: ApolloPerson): DataPerson {
  const id = str(p.id);
  const org = p.organization ?? null;
  const numbers = [...(p.contact?.phone_numbers ?? []), ...(p.phone_numbers ?? [])]
    .map((n) => str(n.sanitized_number) ?? str(n.raw_number))
    .filter((n): n is string => Boolean(n));
  const name =
    str(p.name) ??
    [str(p.first_name), str(p.last_name) ?? str(p.last_name_obfuscated)].filter(Boolean).join(" ");
  return {
    id,
    name,
    title: str(p.title),
    email: str(p.email)?.includes("email_not_unlocked") ? null : str(p.email),
    phones: [...new Set(numbers)],
    linkedinUrl: str(p.linkedin_url),
    city: str(p.city),
    country: str(p.country),
    companyName: org ? str(org.name) : null,
    companyDomain: org ? (str(org.primary_domain) ?? domainOf(org.website_url)) : null,
    sourceUrl: id ? `https://app.apollo.io/#/people/${id}` : "https://app.apollo.io",
  };
}

export function createApolloClient(creds: DataCredentials, ctx: ConnectorContext) {
  const base = "https://api.apollo.io/api/v1";
  async function call(method: "GET" | "POST", path: string, params: Parameters<typeof query>[0]) {
    const qs = query(params);
    const res = await ctx.fetch(`${base}${path}${qs ? `?${qs}` : ""}`, {
      method,
      headers: {
        "x-api-key": creds.apiKey,
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        Accept: "application/json",
      },
    });
    return expectOk(res, `Apollo ${method} ${path}`) as Promise<Record<string, unknown>>;
  }

  return {
    "data.check": async () => {
      const body = await call("GET", "/auth/health", {});
      if (body.is_logged_in !== true) throw new ConnectorError("Apollo no reconoce la API key.", 401, body);
      return { ok: true as const, detail: "Apollo responde" };
    },
    "data.search_people": async (input: PeopleSearch) => {
      const body = await call("POST", "/mixed_people/api_search", {
        person_titles: input.titles,
        q_keywords: input.keywords,
        person_locations: input.locations,
        q_organization_domains_list: input.companyDomains,
        organization_locations: input.companyLocations,
        organization_num_employees_ranges: input.employeeRanges,
        page: 1,
        per_page: clampLimit(input.limit, 25),
      });
      return ((body.people as ApolloPerson[] | undefined) ?? []).map(apolloPerson);
    },
    "data.search_companies": async (input: CompanySearch) => {
      const body = await call("POST", "/mixed_companies/search", {
        q_organization_name: input.name,
        q_organization_keyword_tags: input.keywords,
        organization_locations: input.locations,
        organization_num_employees_ranges: input.employeeRanges,
        page: 1,
        per_page: clampLimit(input.limit, 25),
      });
      const orgs = [
        ...((body.organizations as ApolloOrg[] | undefined) ?? []),
        ...((body.accounts as ApolloOrg[] | undefined) ?? []),
      ];
      return orgs.map(apolloCompany);
    },
    "data.enrich_person": async (input: Parameters<NonNullable<DataClient["data.enrich_person"]>>[0]) => {
      const body = await call("POST", "/people/match", {
        id: input.providerId,
        name: input.name,
        first_name: input.firstName,
        last_name: input.lastName,
        email: input.email,
        organization_name: input.companyName,
        domain: domainOf(input.companyDomain) ?? undefined,
        linkedin_url: input.linkedinUrl,
        reveal_personal_emails: false,
      });
      const person = body.person as ApolloPerson | null | undefined;
      return person ? apolloPerson(person) : null;
    },
    "data.enrich_company": async (input: { domain?: string; name?: string }) => {
      const domain = domainOf(input.domain);
      if (!domain) throw new ConnectorError("Apollo necesita el dominio de la empresa para enriquecerla.");
      const body = await call("GET", "/organizations/enrich", { domain, name: input.name });
      const org = body.organization as ApolloOrg | null | undefined;
      return org ? apolloCompany(org) : null;
    },
  };
}

// ---------------------------------------------------------------------------
// Lusha
// ---------------------------------------------------------------------------

type LushaContact = {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  personId?: number;
  emailAddresses?: { email?: string; emailType?: string }[];
  phoneNumbers?: { number?: string; doNotCall?: boolean }[];
  location?: { city?: string; country?: string };
  jobTitle?: { title?: string };
  socialLinks?: { linkedin?: string };
  company?: { name?: string; domains?: { homepage?: string }; homepageUrl?: string; fqdn?: string };
};

type LushaCompany = {
  id?: number;
  name?: string;
  domain?: string;
  fqdn?: string;
  website?: string;
  mainIndustry?: string;
  companySize?: { min?: number; max?: number };
  location?: { city?: string; country?: string };
  social?: { linkedin?: { url?: string } };
  description?: string;
};

function lushaPerson(c: LushaContact): DataPerson {
  const work = (c.emailAddresses ?? []).filter((e) => e.emailType !== "private");
  return {
    id: c.personId ? String(c.personId) : null,
    name: str(c.fullName) ?? [str(c.firstName), str(c.lastName)].filter(Boolean).join(" "),
    title: str(c.jobTitle?.title),
    email: str(work[0]?.email),
    phones: (c.phoneNumbers ?? [])
      .filter((p) => !p.doNotCall)
      .map((p) => str(p.number))
      .filter((n): n is string => Boolean(n)),
    linkedinUrl: str(c.socialLinks?.linkedin),
    city: str(c.location?.city),
    country: str(c.location?.country),
    companyName: str(c.company?.name),
    companyDomain:
      domainOf(c.company?.domains?.homepage) ?? domainOf(c.company?.homepageUrl) ?? str(c.company?.fqdn),
    sourceUrl: "https://dashboard.lusha.com",
  };
}

function lushaCompany(c: LushaCompany): DataCompany {
  const size = c.companySize;
  return {
    id: c.id ? String(c.id) : null,
    name: str(c.name) ?? "",
    domain: str(c.domain) ?? str(c.fqdn),
    website: str(c.website),
    phone: null,
    industry: str(c.mainIndustry),
    employees: size?.max ?? size?.min ?? null,
    city: str(c.location?.city),
    country: str(c.location?.country),
    linkedinUrl: str(c.social?.linkedin?.url),
    description: str(c.description),
    sourceUrl: "https://dashboard.lusha.com",
  };
}

export function createLushaClient(creds: DataCredentials, ctx: ConnectorContext) {
  const base = "https://api.lusha.com";
  /** Lusha answers 404 when it has no match (no credit spent): that is «not found», not an error. */
  async function get(path: string, params: Record<string, string | undefined>) {
    const qs = new URLSearchParams(
      Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])),
    ).toString();
    const res = await ctx.fetch(`${base}${path}${qs ? `?${qs}` : ""}`, {
      headers: { api_key: creds.apiKey, Accept: "application/json" },
    });
    if (res.status === 404) return null;
    return expectOk(res, `Lusha GET ${path}`) as Promise<Record<string, unknown>>;
  }

  return {
    "data.check": async () => {
      const body = await get("/account/usage", {});
      const usage = (body?.usage ?? {}) as Record<string, { remaining?: number }>;
      const left = Object.entries(usage)
        .filter(([, v]) => typeof v?.remaining === "number")
        .map(([k, v]) => `${k}: ${v.remaining}`)
        .join(", ");
      return { ok: true as const, detail: left ? `Créditos disponibles · ${left}` : "Lusha responde" };
    },
    "data.enrich_person": async (input: Parameters<NonNullable<DataClient["data.enrich_person"]>>[0]) => {
      const [first, ...rest] = (input.name ?? "").trim().split(/\s+/);
      const body = await get("/v2/person", {
        firstName: input.firstName ?? (first || undefined),
        lastName: input.lastName ?? (rest.join(" ") || undefined),
        companyName: input.companyName,
        companyDomain: domainOf(input.companyDomain) ?? undefined,
        email: input.email,
        linkedinUrl: input.linkedinUrl,
      });
      const contact = (body?.contact as { data?: LushaContact | null } | undefined)?.data;
      return contact ? lushaPerson(contact) : null;
    },
    "data.enrich_company": async (input: { domain?: string; name?: string }) => {
      const domain = domainOf(input.domain);
      if (!domain && !input.name)
        throw new ConnectorError("Lusha necesita el dominio o el nombre de la empresa.");
      const body = await get("/v2/company", {
        domain: domain ?? undefined,
        company: domain ? undefined : input.name,
      });
      const data = body?.data as LushaCompany | null | undefined;
      return data ? lushaCompany(data) : null;
    },
  };
}

type DataClient = {
  "data.enrich_person"?: (input: {
    name?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    companyName?: string;
    companyDomain?: string;
    linkedinUrl?: string;
    providerId?: string;
  }) => Promise<DataPerson | null>;
};

export const DATA_PROVIDERS = ["apollo", "lusha"] as const;
export type DataProviderId = (typeof DATA_PROVIDERS)[number];

const CAPABILITIES: Record<DataProviderId, Capability[]> = {
  apollo: [
    "data.check",
    "data.search_people",
    "data.search_companies",
    "data.enrich_person",
    "data.enrich_company",
  ],
  lusha: ["data.check", "data.enrich_person", "data.enrich_company"],
};

export function dataProvider(id: DataProviderId): ConnectorProvider<DataCredentials> {
  return {
    id,
    name: id === "apollo" ? "Apollo" : "Lusha",
    transport: "api",
    credentialsSchema: dataCredentials,
    capabilitiesFor: (scopes) => (scopes.read.includes("data") ? CAPABILITIES[id] : []),
    create: (creds, ctx) =>
      id === "apollo" ? createApolloClient(creds, ctx) : createLushaClient(creds, ctx),
  };
}
