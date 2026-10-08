import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import { mockFetch } from "../../../tests/helpers/fetch";
import { dataTools } from "../agents/tools";
import type { Db } from "../db/client";
import { projects } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { createApolloClient, createHunterClient, createLushaClient } from "./data";
import { createDataConnection } from "./service";

const creds = { apiKey: "key-1234567890abcd" };

describe("Apollo", () => {
  it("searches people with the API key and array filters, without spending credits", async () => {
    const { fetch, requests } = mockFetch({
      "POST https://api.apollo.io/api/v1/mixed_people/api_search": () => ({
        total_entries: 1,
        people: [
          {
            id: "p1",
            first_name: "Luis",
            last_name_obfuscated: "Ga***a",
            title: "Gerente",
            organization: { name: "Autos García" },
          },
        ],
      }),
    });
    const people = await createApolloClient(creds, { fetch })["data.search_people"]({
      titles: ["Gerente", "Director comercial"],
      companyDomains: ["autosgarcia.es"],
      limit: 5,
    });
    expect(requests[0].headers["x-api-key"]).toBe("key-1234567890abcd");
    const url = new URL(requests[0].url);
    expect(url.searchParams.getAll("person_titles[]")).toEqual(["Gerente", "Director comercial"]);
    expect(url.searchParams.getAll("q_organization_domains_list[]")).toEqual(["autosgarcia.es"]);
    expect(url.searchParams.get("per_page")).toBe("5");
    expect(people).toEqual([
      expect.objectContaining({
        id: "p1",
        name: "Luis Ga***a",
        title: "Gerente",
        email: null,
        companyName: "Autos García",
        sourceUrl: "https://app.apollo.io/#/people/p1",
      }),
    ]);
  });

  it("enriches a person and a company", async () => {
    const { fetch, requests } = mockFetch({
      "POST https://api.apollo.io/api/v1/people/match": () => ({
        person: {
          id: "p1",
          name: "Luis García",
          email: "luis@autosgarcia.es",
          title: "Gerente",
          linkedin_url: "https://linkedin.com/in/luis",
          contact: { phone_numbers: [{ sanitized_number: "+34952000000" }] },
          organization: { name: "Autos García", primary_domain: "autosgarcia.es" },
        },
      }),
      "GET https://api.apollo.io/api/v1/organizations/enrich": () => ({
        organization: {
          id: "o1",
          name: "Autos García",
          primary_domain: "autosgarcia.es",
          industry: "automotive",
          estimated_num_employees: 25,
          city: "Málaga",
          country: "Spain",
        },
      }),
    });
    const client = createApolloClient(creds, { fetch });
    const person = await client["data.enrich_person"]({
      name: "Luis García",
      companyDomain: "https://www.autosgarcia.es",
    });
    expect(new URL(requests[0].url).searchParams.get("domain")).toBe("autosgarcia.es");
    expect(new URL(requests[0].url).searchParams.get("reveal_personal_emails")).toBe("false");
    expect(person).toMatchObject({
      email: "luis@autosgarcia.es",
      phones: ["+34952000000"],
      companyDomain: "autosgarcia.es",
    });
    const company = await client["data.enrich_company"]({ domain: "www.autosgarcia.es" });
    expect(company).toMatchObject({ name: "Autos García", employees: 25, city: "Málaga" });
  });
});

describe("Lusha", () => {
  it("enriches a person with work emails and callable phones only", async () => {
    const { fetch, requests } = mockFetch({
      "GET https://api.lusha.com/v2/person": () => ({
        contact: {
          isCreditCharged: true,
          data: {
            fullName: "Ana Ruiz",
            emailAddresses: [
              { email: "ana@gmail.com", emailType: "private" },
              { email: "ana@motorsur.es", emailType: "work" },
            ],
            phoneNumbers: [
              { number: "+34 600 000 000", doNotCall: true },
              { number: "+34 954 000 000", doNotCall: false },
            ],
            jobTitle: { title: "Directora" },
            company: { name: "Motor Sur", domains: { homepage: "motorsur.es" } },
          },
        },
      }),
    });
    const person = await createLushaClient(creds, { fetch })["data.enrich_person"]({
      name: "Ana Ruiz",
      companyName: "Motor Sur",
    });
    expect(requests[0].headers.api_key).toBe("key-1234567890abcd");
    const url = new URL(requests[0].url);
    expect([url.searchParams.get("firstName"), url.searchParams.get("lastName")]).toEqual(["Ana", "Ruiz"]);
    expect(person).toMatchObject({
      email: "ana@motorsur.es",
      phones: ["+34 954 000 000"],
      title: "Directora",
      companyDomain: "motorsur.es",
    });
  });

  it("treats «no match» as not found and reports the credits left", async () => {
    const { fetch } = mockFetch({
      "GET https://api.lusha.com/v2/person": () => new Response("{}", { status: 404 }),
      "GET https://api.lusha.com/account/usage": () => ({
        usage: { credits: { used: 10, total: 100, remaining: 90 } },
      }),
    });
    const client = createLushaClient(creds, { fetch });
    expect(await client["data.enrich_person"]({ email: "nadie@x.es" })).toBeNull();
    expect(await client["data.check"]()).toEqual({ ok: true, detail: "Créditos disponibles · credits: 90" });
  });
});

describe("Hunter", () => {
  it("finds people at each company domain, filtered by title, with their work emails", async () => {
    const { fetch, requests } = mockFetch({
      "GET https://api.hunter.io/v2/domain-search": (req) =>
        new URL(req.url).searchParams.get("domain") === "autosgarcia.es"
          ? {
              data: {
                organization: "Autos García",
                emails: [
                  {
                    value: "luis@autosgarcia.es",
                    first_name: "Luis",
                    last_name: "García",
                    position: "Gerente",
                  },
                  { value: "info@autosgarcia.es", position: "Recepción" },
                ],
              },
            }
          : { data: { organization: "Motor Sur", emails: [] } },
    });
    const people = await createHunterClient(creds, { fetch })["data.search_people"]({
      titles: ["gerente"],
      companyDomains: ["https://www.autosgarcia.es", "motorsur.es"],
      limit: 5,
    });
    expect(requests).toHaveLength(2);
    expect(requests[0].headers["x-api-key"]).toBe("key-1234567890abcd");
    expect(new URL(requests[0].url).searchParams.get("type")).toBe("personal");
    expect(people).toEqual([
      expect.objectContaining({
        name: "Luis García",
        title: "Gerente",
        email: "luis@autosgarcia.es",
        companyName: "Autos García",
        companyDomain: "autosgarcia.es",
        sourceUrl: "https://hunter.io/search/autosgarcia.es",
      }),
    ]);
    await expect(
      createHunterClient(creds, { fetch })["data.search_people"]({ titles: ["CEO"] }),
    ).rejects.toThrow("companyDomains");
  });

  it("finds an email by name and domain, verifies it, and treats 404 as not found", async () => {
    const { fetch, requests } = mockFetch({
      "GET https://api.hunter.io/v2/email-finder": () => ({
        data: {
          email: "ana@acme.es",
          first_name: "Ana",
          last_name: "Ruiz",
          position: "CEO",
          domain: "acme.es",
        },
      }),
      "GET https://api.hunter.io/v2/email-verifier": () => ({ data: { status: "valid", score: 97 } }),
    });
    const client = createHunterClient(creds, { fetch });
    const person = await client["data.enrich_person"]({ name: "Ana Ruiz Pérez", companyDomain: "acme.es" });
    const finder = new URL(requests[0].url).searchParams;
    expect(finder.get("first_name")).toBe("Ana");
    expect(finder.get("last_name")).toBe("Ruiz Pérez");
    expect(person).toMatchObject({ name: "Ana Ruiz", email: "ana@acme.es", title: "CEO" });
    expect(await client["data.verify_email"]({ email: "ana@acme.es" })).toEqual({
      email: "ana@acme.es",
      status: "valid",
      score: 97,
      sourceUrl: "https://hunter.io/verify",
    });
    // No company data for that domain.
    expect(await client["data.enrich_company"]({ domain: "nadie.es" })).toBeNull();
  });
});

describe("data connections and agent tools", () => {
  let db: Db;
  let close: () => Promise<void>;
  let tenant: TenantContext;
  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    const seeded = await seedOrg(db, "Datos");
    tenant = { orgId: seeded.orgId, actorType: "user", actorId: seeded.userId };
  });
  afterAll(async () => close());

  it("checks the key before saving it, and gives the agent tools by what the provider offers", async () => {
    const { fetch } = mockFetch({
      "GET https://api.apollo.io/api/v1/auth/health": () => ({ healthy: true, is_logged_in: true }),
      "GET https://api.lusha.com/account/usage": () => ({ usage: {} }),
      "GET https://api.lusha.com/v2/company": () => ({ data: { name: "Motor Sur", domain: "motorsur.es" } }),
    });
    const apollo = await createDataConnection({ db, fetch }, tenant, {
      provider: "apollo",
      label: "Apollo",
      apiKey: creds.apiKey,
    });
    expect(apollo).toMatchObject({
      provider: "apollo",
      accountRef: "clave …abcd",
      readScopes: ["data"],
      writeScopes: [],
    });
    const lusha = await createDataConnection({ db, fetch }, tenant, {
      provider: "lusha",
      label: "Lusha",
      apiKey: creds.apiKey,
    });

    const { fetch: bad } = mockFetch({
      "GET https://api.apollo.io/api/v1/auth/health": () => new Response("Invalid", { status: 401 }),
    });
    await expect(
      createDataConnection({ db, fetch: bad }, tenant, {
        provider: "apollo",
        label: "X",
        apiKey: "otra-clave-0000",
      }),
    ).rejects.toThrow(/401/);

    const [project] = await withTenant(db, tenant, (tx) =>
      tx.insert(projects).values({ orgId: tenant.orgId, name: "P" }).returning(),
    );
    const ctx = {
      db,
      orgId: tenant.orgId,
      projectId: project.id,
      agentType: "outbound" as const,
      runId: "run",
      gateway: { db, executor: { execute: async () => ({}) } },
      connectors: { fetch },
      timezone: "Europe/Madrid",
    };
    const tools = await dataTools(ctx, [apollo.id, lusha.id]);
    expect(tools.map((t) => t.name).sort()).toEqual([
      "apollo_enrich_company",
      "apollo_enrich_person",
      "apollo_search_companies",
      "apollo_search_people",
      "lusha_enrich_company",
      "lusha_enrich_person",
    ]);
    const enrich = tools.find((t) => t.name === "lusha_enrich_company")!;
    expect(await enrich.run({ domain: "motorsur.es" })).toMatchObject({ name: "Motor Sur" });
    // A failing call comes back as an error the agent can read, not an exception.
    const failing = tools.find((t) => t.name === "apollo_enrich_company")!;
    expect(await failing.run({ name: "Sin dominio" })).toMatchObject({
      error: expect.stringContaining("dominio"),
    });
  });
});
