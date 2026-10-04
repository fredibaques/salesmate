import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  ConnectorError,
  expectOk,
  type Capability,
  type ConnectorContext,
  type ConnectorProvider,
  type CrmObjectInfo,
  type CrmPerson,
} from "./types";

/**
 * Twenty CRM over its REST API (`/rest/…`, `/rest/metadata/…`).
 * Works with Twenty Cloud (https://api.twenty.com) and self-hosted instances.
 * Webhooks are verified with the workspace webhook secret.
 */

export const twentyCredentials = z.object({
  baseUrl: z
    .string()
    .url()
    .transform((u) => u.replace(/\/+$/, "").replace(/\/rest$/, "")),
  apiKey: z.string().min(10),
  webhookSecret: z.string().optional(),
});
export type TwentyCredentials = z.infer<typeof twentyCredentials>;

type TwentyPerson = {
  id: string;
  name?: { firstName?: string | null; lastName?: string | null } | null;
  emails?: { primaryEmail?: string | null } | null;
  phones?: { primaryPhoneNumber?: string | null; primaryPhoneCallingCode?: string | null } | null;
  jobTitle?: string | null;
  companyId?: string | null;
};

/** Twenty wraps results as { data: { <key>: value } }; return that value. */
function unwrap<T>(body: unknown): T {
  const data = (body as { data?: Record<string, unknown> } | null)?.data;
  if (!data || typeof data !== "object") throw new ConnectorError("Unexpected Twenty response", undefined, body);
  const [value] = Object.values(data);
  return value as T;
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function toPerson(p: TwentyPerson): CrmPerson {
  const phone = p.phones?.primaryPhoneNumber
    ? `${p.phones.primaryPhoneCallingCode ?? ""}${p.phones.primaryPhoneNumber}`
    : null;
  return {
    id: p.id,
    firstName: p.name?.firstName ?? "",
    lastName: p.name?.lastName ?? "",
    email: p.emails?.primaryEmail ?? null,
    phone,
    jobTitle: p.jobTitle ?? null,
    companyId: p.companyId ?? null,
  };
}

export function createTwentyClient(creds: TwentyCredentials, ctx: ConnectorContext) {
  async function call(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await ctx.fetch(`${creds.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return expectOk(res, `Twenty ${method} ${path}`);
  }

  async function list<T>(object: string, params: Record<string, string>): Promise<T[]> {
    const qs = new URLSearchParams(params).toString();
    return unwrap<T[]>(await call("GET", `/rest/${object}${qs ? `?${qs}` : ""}`));
  }

  async function findCompanyId(name: string): Promise<string> {
    const [existing] = await list<{ id: string }>("companies", {
      filter: `name[ilike]:${quote(name)}`,
      limit: "1",
    });
    if (existing) return existing.id;
    const created = unwrap<{ id: string }>(await call("POST", "/rest/companies", { name }));
    return created.id;
  }

  async function linkTarget(kind: "taskTargets" | "noteTargets", key: "taskId" | "noteId", id: string, personId?: string) {
    if (!personId) return;
    await call("POST", `/rest/${kind}`, { [key]: id, personId });
  }

  return {
    async "crm.search_people"({ query, email, limit = 10 }: { query?: string; email?: string; limit?: number }) {
      let filter: string | undefined;
      if (email) filter = `emails.primaryEmail[eq]:${quote(email.toLowerCase())}`;
      else if (query) {
        const like = quote(`%${query}%`);
        filter = `or(name.firstName[ilike]:${like},name.lastName[ilike]:${like},emails.primaryEmail[ilike]:${like})`;
      }
      const people = await list<TwentyPerson>("people", {
        ...(filter ? { filter } : {}),
        limit: String(limit),
      });
      return people.map(toPerson);
    },

    async "crm.describe"(): Promise<CrmObjectInfo[]> {
      const objects = unwrap<
        {
          nameSingular: string;
          namePlural: string;
          labelSingular: string;
          labelPlural: string;
          description?: string | null;
          isCustom?: boolean;
          isSystem?: boolean;
          isActive?: boolean;
        }[]
      >(await call("GET", "/rest/metadata/objects"));
      return objects
        .filter((o) => o.isActive !== false && !o.isSystem)
        .map((o) => ({
          name: o.namePlural,
          labelSingular: o.labelSingular,
          labelPlural: o.labelPlural,
          description: o.description ?? null,
          custom: Boolean(o.isCustom),
        }));
    },

    async "crm.upsert_contact"(input: {
      email?: string;
      firstName: string;
      lastName: string;
      phone?: string;
      jobTitle?: string;
      companyName?: string;
    }) {
      const record: Record<string, unknown> = {
        name: { firstName: input.firstName, lastName: input.lastName },
      };
      if (input.email) record.emails = { primaryEmail: input.email.toLowerCase() };
      if (input.phone) record.phones = { primaryPhoneNumber: input.phone };
      if (input.jobTitle) record.jobTitle = input.jobTitle;
      if (input.companyName) record.companyId = await findCompanyId(input.companyName);

      const [existing] = input.email
        ? await list<TwentyPerson>("people", {
            filter: `emails.primaryEmail[eq]:${quote(input.email.toLowerCase())}`,
            limit: "1",
          })
        : [];
      if (existing) {
        await call("PATCH", `/rest/people/${existing.id}`, record);
        return { id: existing.id, created: false };
      }
      const created = unwrap<TwentyPerson>(await call("POST", "/rest/people", record));
      return { id: created.id, created: true };
    },

    async "crm.create_task"(input: { title: string; body: string; dueAt?: string; personExternalId?: string }) {
      const task = unwrap<{ id: string }>(
        await call("POST", "/rest/tasks", {
          title: input.title,
          bodyV2: { markdown: input.body },
          status: "TODO",
          ...(input.dueAt ? { dueAt: input.dueAt } : {}),
        }),
      );
      await linkTarget("taskTargets", "taskId", task.id, input.personExternalId);
      return { id: task.id };
    },

    async "crm.log_note"(input: { title: string; body: string; personExternalId?: string }) {
      const note = unwrap<{ id: string }>(
        await call("POST", "/rest/notes", { title: input.title, bodyV2: { markdown: input.body } }),
      );
      await linkTarget("noteTargets", "noteId", note.id, input.personExternalId);
      return { id: note.id };
    },
  };
}

export const twentyProvider: ConnectorProvider<TwentyCredentials> = {
  id: "twenty",
  name: "Twenty CRM",
  transport: "api",
  credentialsSchema: twentyCredentials,
  capabilitiesFor({ write }) {
    const read: Capability[] = ["crm.search_people", "crm.describe"];
    return write.includes("crm") ? [...read, "crm.upsert_contact", "crm.create_task", "crm.log_note"] : read;
  },
  create: createTwentyClient,
};

/**
 * Twenty signs webhooks with HMAC-SHA256 over `${timestamp}:${rawBody}`
 * (headers X-Twenty-Webhook-Signature / X-Twenty-Webhook-Timestamp).
 */
export function verifyTwentyWebhook(input: {
  secret: string;
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  now?: Date;
  toleranceSeconds?: number;
}): boolean {
  if (!input.signature || !input.timestamp) return false;
  const ts = Number(input.timestamp);
  if (Number.isFinite(ts)) {
    const millis = ts > 1e12 ? ts : ts * 1000;
    const skew = Math.abs((input.now ?? new Date()).getTime() - millis) / 1000;
    if (skew > (input.toleranceSeconds ?? 600)) return false;
  }
  const expected = createHmac("sha256", input.secret)
    .update(`${input.timestamp}:${input.rawBody}`)
    .digest("hex");
  const given = Buffer.from(input.signature, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}
