import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mockFetch } from "../../../tests/helpers/fetch";
import { createTwentyClient, twentyCredentials, verifyTwentyWebhook } from "./twenty";

const creds = twentyCredentials.parse({ baseUrl: "https://crm.example.com/rest/", apiKey: "key-1234567890" });

describe("Twenty connector", () => {
  it("normalizes the base URL and authenticates with the API key", async () => {
    const { fetch, requests } = mockFetch({
      "GET https://crm.example.com/rest/people": () => ({ data: { people: [] } }),
    });
    await createTwentyClient(creds, { fetch })["crm.search_people"]({ query: "Ana" });
    expect(requests[0].headers.authorization).toBe("Bearer key-1234567890");
    const filter = new URL(requests[0].url).searchParams.get("filter");
    expect(filter).toBe(
      'or(name.firstName[ilike]:"%Ana%",name.lastName[ilike]:"%Ana%",emails.primaryEmail[ilike]:"%Ana%")',
    );
  });

  it("updates an existing person matched by email", async () => {
    const { fetch, requests } = mockFetch({
      "GET https://crm.example.com/rest/people": () => ({
        data: { people: [{ id: "p1", name: { firstName: "Ana", lastName: "" } }] },
      }),
      "PATCH https://crm.example.com/rest/people/p1": () => ({ data: { updatePerson: { id: "p1" } } }),
    });
    const result = await createTwentyClient(creds, { fetch })["crm.upsert_contact"]({
      email: "Ana@Cliente.com",
      firstName: "Ana",
      lastName: "López",
    });
    expect(result).toEqual({ id: "p1", created: false });
    expect(new URL(requests[0].url).searchParams.get("filter")).toBe(
      'emails.primaryEmail[eq]:"ana@cliente.com"',
    );
    expect(requests[1].body).toMatchObject({
      name: { firstName: "Ana", lastName: "López" },
      emails: { primaryEmail: "ana@cliente.com" },
    });
  });

  it("creates a person with its company when not found", async () => {
    const { fetch, requests } = mockFetch({
      "GET https://crm.example.com/rest/people": () => ({ data: { people: [] } }),
      "GET https://crm.example.com/rest/companies": () => ({ data: { companies: [] } }),
      "POST https://crm.example.com/rest/companies": () => ({ data: { createCompany: { id: "c1" } } }),
      "POST https://crm.example.com/rest/people": () => ({ data: { createPerson: { id: "p2" } } }),
    });
    const result = await createTwentyClient(creds, { fetch })["crm.upsert_contact"]({
      email: "luis@acme.com",
      firstName: "Luis",
      lastName: "",
      companyName: "Acme",
    });
    expect(result).toEqual({ id: "p2", created: true });
    expect(requests.at(-1)?.body).toMatchObject({ companyId: "c1" });
  });

  it("creates tasks linked to a person", async () => {
    const { fetch, requests } = mockFetch({
      "POST https://crm.example.com/rest/tasks": () => ({ data: { createTask: { id: "t1" } } }),
      "POST https://crm.example.com/rest/taskTargets": () => ({ data: { createTaskTarget: { id: "tt1" } } }),
    });
    const task = await createTwentyClient(creds, { fetch })["crm.create_task"]({
      title: "Llamar",
      body: "Preparar propuesta",
      personExternalId: "p1",
    });
    expect(task).toEqual({ id: "t1" });
    expect(requests[0].body).toMatchObject({
      title: "Llamar",
      bodyV2: { markdown: "Preparar propuesta" },
      status: "TODO",
    });
    expect(requests[1].body).toEqual({ taskId: "t1", personId: "p1" });
  });

  it("lists active non-system objects, including custom ones", async () => {
    const { fetch } = mockFetch({
      "GET https://crm.example.com/rest/metadata/objects": () => ({
        data: {
          objects: [
            {
              nameSingular: "person",
              namePlural: "people",
              labelSingular: "Person",
              labelPlural: "People",
              isCustom: false,
            },
            {
              nameSingular: "quote",
              namePlural: "quotes",
              labelSingular: "Quote",
              labelPlural: "Quotes",
              isCustom: true,
            },
            {
              nameSingular: "blocklist",
              namePlural: "blocklists",
              labelSingular: "B",
              labelPlural: "Bs",
              isSystem: true,
            },
          ],
        },
      }),
    });
    const objects = await createTwentyClient(creds, { fetch })["crm.describe"]();
    expect(objects.map((o) => [o.name, o.custom])).toEqual([
      ["people", false],
      ["quotes", true],
    ]);
  });

  it("surfaces HTTP errors", async () => {
    const { fetch } = mockFetch({
      "GET https://crm.example.com/rest/people": () => new Response("nope", { status: 401 }),
    });
    await expect(createTwentyClient(creds, { fetch })["crm.search_people"]({})).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe("Twenty webhook signature", () => {
  const secret = "whsec";
  const body = JSON.stringify({ event: "person.created", data: { id: "p1" } });
  const now = new Date("2026-10-07T10:00:00Z");
  const timestamp = String(now.getTime());
  const signature = createHmac("sha256", secret).update(`${timestamp}:${body}`).digest("hex");

  it("accepts a valid signature", () => {
    expect(verifyTwentyWebhook({ secret, rawBody: body, signature, timestamp, now })).toBe(true);
  });

  it("rejects altered bodies, missing headers and stale timestamps", () => {
    expect(verifyTwentyWebhook({ secret, rawBody: `${body} `, signature, timestamp, now })).toBe(false);
    expect(verifyTwentyWebhook({ secret, rawBody: body, signature: null, timestamp, now })).toBe(false);
    expect(
      verifyTwentyWebhook({
        secret,
        rawBody: body,
        signature,
        timestamp,
        now: new Date(now.getTime() + 3_600_000),
      }),
    ).toBe(false);
  });
});
