import { z } from "zod";
import { ConnectorError, expectOk, type ConnectorContext, type ConnectorProvider } from "./types";

/**
 * Where the team organises its work: Airtable, Trello and monday.com. A
 * SalesMate table can be exported there (a new Airtable table, one card or
 * item per row) and agents can create tasks for the team (Trello cards,
 * monday items) in the connection's default place. Every write goes through
 * the gateway (table.export, task.create).
 */

export const WORKSPACE_PROVIDERS = ["airtable", "trello", "monday"] as const;
export type WorkspaceProviderId = (typeof WORKSPACE_PROVIDERS)[number];

/** Rows written to a tool that creates one card or item per row. */
export const MAX_EXPORT_ROWS = 100;

const tokenOnly = z.object({ token: z.string().trim().min(20, "El token no parece válido.") });
const trelloCreds = z.object({
  key: z.string().trim().min(20, "La API key no parece válida."),
  token: z.string().trim().min(20, "El token no parece válido."),
});
export type WorkspaceCredentials = { token: string; key?: string };

/** One line per field: «Campo: valor», leaving out the empty ones. */
function details(header: string[], row: string[], skip = 1): string {
  return header
    .map((h, i) => (i >= skip && row[i]?.trim() ? `${h}: ${row[i]}` : null))
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Airtable
// ---------------------------------------------------------------------------

export function createAirtableClient(creds: { token: string }, ctx: ConnectorContext) {
  const api = async (path: string, init: RequestInit & { json?: unknown } = {}) => {
    const { json, ...rest } = init;
    const res = await ctx.fetch(`https://api.airtable.com/v0/${path}`, {
      ...rest,
      headers: { authorization: `Bearer ${creds.token}`, "content-type": "application/json" },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
    return expectOk(res, `Airtable ${rest.method ?? "GET"} ${path.split("?")[0]}`);
  };
  return {
    async check() {
      const me = (await api("meta/whoami")) as { email?: string; id?: string };
      return { account: me.email ?? me.id ?? "Airtable" };
    },
    "export.targets": async () => {
      const body = (await api("meta/bases")) as { bases?: { id: string; name: string }[] };
      return (body.bases ?? []).map((b) => ({ id: b.id, label: b.name }));
    },
    /** A new table in the base (target), every column as text, and its rows. */
    "table.export": async (input: {
      name: string;
      header: string[];
      rows: string[][];
      target?: string | null;
    }) => {
      if (!input.target) throw new ConnectorError("Elige la base de Airtable.");
      // Field names must be unique and not empty.
      const seen = new Map<string, number>();
      const fields = input.header.map((h) => {
        const base = h.trim() || "Campo";
        const n = (seen.get(base) ?? 0) + 1;
        seen.set(base, n);
        return n > 1 ? `${base} ${n}` : base;
      });
      const table = (await api(`meta/bases/${input.target}/tables`, {
        method: "POST",
        json: {
          name: `${input.name} · ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
          fields: fields
            .map((name) => ({ name, type: "multilineText" }))
            .map((f, i) =>
              // The first field is the primary one: single line text.
              i === 0 ? { ...f, type: "singleLineText" } : f,
            ),
        },
      })) as { id: string };
      for (let i = 0; i < input.rows.length; i += 10) {
        await api(`${input.target}/${table.id}`, {
          method: "POST",
          json: {
            typecast: true,
            records: input.rows.slice(i, i + 10).map((row) => ({
              fields: Object.fromEntries(fields.map((f, j) => [f, row[j] ?? ""])),
            })),
          },
        });
      }
      return { url: `https://airtable.com/${input.target}/${table.id}`, count: input.rows.length };
    },
  };
}

// ---------------------------------------------------------------------------
// Trello
// ---------------------------------------------------------------------------

export function createTrelloClient(creds: { key: string; token: string }, ctx: ConnectorContext) {
  const api = async (path: string, params: Record<string, string> = {}, method = "GET") => {
    const qs = new URLSearchParams({ key: creds.key, token: creds.token, ...params });
    const res = await ctx.fetch(`https://api.trello.com/1/${path}?${qs}`, { method });
    return expectOk(res, `Trello ${method} ${path}`);
  };
  const card = async (list: string, name: string, desc: string) =>
    (await api("cards", { idList: list, name: name.slice(0, 500), desc: desc.slice(0, 16_000) }, "POST")) as {
      id: string;
      url?: string;
    };
  return {
    async check() {
      const me = (await api("members/me", { fields: "fullName,username" })) as {
        fullName?: string;
        username?: string;
      };
      return { account: me.username ?? me.fullName ?? "Trello" };
    },
    /** Every list of every open board, as «Tablero › Lista». */
    "export.targets": async () => {
      const boards = (await api("members/me/boards", { filter: "open", fields: "name", lists: "open" })) as {
        id: string;
        name: string;
        lists?: { id: string; name: string }[];
      }[];
      return boards.flatMap((b) =>
        (b.lists ?? []).map((l) => ({ id: l.id, label: `${b.name} › ${l.name}` })),
      );
    },
    "table.export": async (input: {
      name: string;
      header: string[];
      rows: string[][];
      target?: string | null;
    }) => {
      if (!input.target) throw new ConnectorError("Elige la lista de Trello.");
      for (const row of input.rows.slice(0, MAX_EXPORT_ROWS)) {
        await card(input.target, row[0] || input.name, details(input.header, row));
      }
      return { url: null, count: Math.min(input.rows.length, MAX_EXPORT_ROWS) };
    },
    "task.create": async (input: { title: string; body: string; target?: string | null }) => {
      if (!input.target) throw new ConnectorError("La conexión de Trello no tiene lista para tareas.");
      const created = await card(input.target, input.title, input.body);
      return { id: created.id, url: created.url ?? null };
    },
  };
}

// ---------------------------------------------------------------------------
// monday.com
// ---------------------------------------------------------------------------

export function createMondayClient(creds: { token: string }, ctx: ConnectorContext) {
  const gql = async <T>(query: string, variables: Record<string, unknown> = {}): Promise<T> => {
    const res = await ctx.fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: { authorization: creds.token, "content-type": "application/json", "API-Version": "2024-10" },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await expectOk(res, "monday.com")) as { data?: T; errors?: { message: string }[] };
    if (body.errors?.length) throw new ConnectorError(`monday.com: ${body.errors[0].message}`, 400, body);
    return body.data as T;
  };
  const item = async (board: string, name: string, update: string) => {
    const created = await gql<{ create_item: { id: string } }>(
      "mutation ($board: ID!, $name: String!) { create_item (board_id: $board, item_name: $name) { id } }",
      { board, name: name.slice(0, 255) },
    );
    if (update.trim()) {
      await gql(
        "mutation ($item: ID!, $body: String!) { create_update (item_id: $item, body: $body) { id } }",
        {
          item: created.create_item.id,
          body: update.replace(/\n/g, "<br>"),
        },
      );
    }
    return created.create_item.id;
  };
  return {
    async check() {
      const data = await gql<{ me: { name?: string; account?: { name?: string } } }>(
        "query { me { name account { name } } }",
      );
      return { account: data.me.account?.name ?? data.me.name ?? "monday.com" };
    },
    "export.targets": async () => {
      const data = await gql<{ boards: { id: string; name: string }[] }>(
        "query { boards (limit: 100, state: active) { id name } }",
      );
      return data.boards.map((b) => ({ id: String(b.id), label: b.name }));
    },
    "table.export": async (input: {
      name: string;
      header: string[];
      rows: string[][];
      target?: string | null;
    }) => {
      if (!input.target) throw new ConnectorError("Elige el tablero de monday.com.");
      for (const row of input.rows.slice(0, MAX_EXPORT_ROWS)) {
        await item(input.target, row[0] || input.name, details(input.header, row));
      }
      return { url: null, count: Math.min(input.rows.length, MAX_EXPORT_ROWS) };
    },
    "task.create": async (input: { title: string; body: string; target?: string | null }) => {
      if (!input.target) throw new ConnectorError("La conexión de monday.com no tiene tablero para tareas.");
      return { id: await item(input.target, input.title, input.body), url: null };
    },
  };
}

// ---------------------------------------------------------------------------

export const workspaceCredentials: Record<WorkspaceProviderId, z.ZodType<WorkspaceCredentials>> = {
  airtable: tokenOnly,
  trello: trelloCreds,
  monday: tokenOnly,
};

export function workspaceClient(id: WorkspaceProviderId, creds: WorkspaceCredentials, ctx: ConnectorContext) {
  if (id === "trello") return createTrelloClient({ key: creds.key ?? "", token: creds.token }, ctx);
  if (id === "monday") return createMondayClient(creds, ctx);
  return createAirtableClient(creds, ctx);
}

export function workspaceProvider(id: WorkspaceProviderId): ConnectorProvider<WorkspaceCredentials> {
  return {
    id,
    name: { airtable: "Airtable", trello: "Trello", monday: "monday.com" }[id],
    transport: "api",
    credentialsSchema: workspaceCredentials[id],
    capabilitiesFor: (scopes) =>
      scopes.write.includes("workspace")
        ? id === "airtable"
          ? ["export.targets", "table.export"]
          : ["export.targets", "table.export", "task.create"]
        : [],
    create: (creds, ctx) => {
      const { check: _check, ...caps } = workspaceClient(id, creds, ctx);
      return caps;
    },
  };
}
