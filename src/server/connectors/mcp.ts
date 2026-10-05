import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "../audit";
import { decryptJson, encryptJson } from "../crypto";
import type { Db } from "../db/client";
import { connections } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";

/**
 * Remote MCP servers as connections. The organization adds a server (URL and
 * an optional token); we list its tools and each agent is allowed a subset.
 * Tools the server marks as read-only run directly; anything else goes
 * through the Action Gateway as `mcp.call_tool`, so approvals and audit apply.
 */

export const mcpCredentials = z.object({
  url: z.string().url(),
  token: z.string().optional(),
});
export type McpCredentials = z.infer<typeof mcpCredentials>;

export type McpToolInfo = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  /** Declared by the server (`readOnlyHint`); unknown means it may change things. */
  readOnly: boolean;
};

export type McpDeps = {
  /** Builds the transport (tests use an in-memory one). */
  transport?: (creds: McpCredentials) => Transport;
  fetch?: typeof fetch;
};

function defaultTransport(creds: McpCredentials, fetchImpl?: typeof fetch): Transport {
  return new StreamableHTTPClientTransport(new URL(creds.url), {
    requestInit: creds.token ? { headers: { Authorization: `Bearer ${creds.token}` } } : undefined,
    fetch: fetchImpl,
  });
}

async function withClient<T>(deps: McpDeps, creds: McpCredentials, fn: (client: Client) => Promise<T>) {
  const client = new Client({ name: "salesmate", version: "1.0.0" });
  await client.connect(deps.transport ? deps.transport(creds) : defaultTransport(creds, deps.fetch));
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

export async function listMcpTools(deps: McpDeps, creds: McpCredentials): Promise<McpToolInfo[]> {
  return withClient(deps, creds, async (client) => {
    const tools: McpToolInfo[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined);
      for (const t of page.tools) {
        tools.push({
          name: t.name,
          title: t.title ?? t.annotations?.title,
          description: t.description,
          inputSchema: t.inputSchema as Record<string, unknown>,
          readOnly: t.annotations?.readOnlyHint === true,
        });
      }
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  });
}

/** Calls a tool and returns what an agent can read: structured content or the text parts. */
export async function callMcpTool(
  deps: McpDeps,
  creds: McpCredentials,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return withClient(deps, creds, async (client) => {
    const result = await client.callTool({ name, arguments: args });
    const parts = (Array.isArray(result.content) ? result.content : []) as { type: string; text?: string }[];
    const text = parts
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text)
      .join("\n");
    if (result.isError) throw new Error(text || `La herramienta «${name}» devolvió un error.`);
    return result.structuredContent ?? text;
  });
}

// ---------------------------------------------------------------------------
// Stored connections
// ---------------------------------------------------------------------------

export type ConnectionRow = typeof connections.$inferSelect;

export function mcpToolsOf(conn: Pick<ConnectionRow, "metadata">): McpToolInfo[] {
  return (conn.metadata.tools as McpToolInfo[] | undefined) ?? [];
}

/** Adds (or updates) an MCP server after checking that it answers and listing its tools. */
export async function createMcpConnection(
  deps: McpDeps & { db: Db },
  tenant: TenantContext,
  input: { label: string; url: string; token?: string },
): Promise<ConnectionRow> {
  const creds = mcpCredentials.parse({ url: input.url, token: input.token || undefined });
  const tools = await listMcpTools(deps, creds);
  return withTenant(deps.db, tenant, async (tx) => {
    const [row] = await tx
      .insert(connections)
      .values({
        orgId: tenant.orgId,
        provider: "mcp",
        transport: "mcp",
        label: input.label,
        accountRef: creds.url,
        credentialsEncrypted: encryptJson(creds),
        metadata: { tools },
        createdBy: tenant.actorId,
      })
      .onConflictDoUpdate({
        target: [connections.orgId, connections.provider, connections.accountRef],
        set: {
          label: input.label,
          credentialsEncrypted: encryptJson(creds),
          status: "active",
          lastError: null,
          metadata: { tools },
        },
      })
      .returning();
    await audit(tx, tenant, {
      event: "connection.saved",
      entityType: "connection",
      entityId: row.id,
      data: { provider: "mcp", url: creds.url, tools: tools.length },
    });
    return row;
  });
}

async function loadMcp(db: Db, tenant: Pick<TenantContext, "orgId">, connectionId: string) {
  const row = await withTenant(db, tenant, async (tx) => {
    const [found] = await tx.select().from(connections).where(eq(connections.id, connectionId));
    return found;
  });
  if (!row || row.provider !== "mcp") throw new Error("Servidor MCP no encontrado.");
  if (row.status !== "active") throw new Error("El servidor MCP no está activo.");
  if (!row.credentialsEncrypted) throw new Error("El servidor MCP no tiene credenciales.");
  return { row, creds: mcpCredentials.parse(decryptJson(row.credentialsEncrypted)) };
}

/** Re-reads the tool list of a stored server (after the server changes). */
export async function refreshMcpTools(
  deps: McpDeps & { db: Db },
  tenant: TenantContext,
  connectionId: string,
): Promise<McpToolInfo[]> {
  const { creds } = await loadMcp(deps.db, tenant, connectionId);
  const tools = await listMcpTools(deps, creds);
  await withTenant(deps.db, tenant, (tx) =>
    tx
      .update(connections)
      .set({ metadata: { tools }, status: "active", lastError: null })
      .where(eq(connections.id, connectionId)),
  );
  return tools;
}

export async function callStoredMcpTool(
  deps: McpDeps & { db: Db },
  tenant: Pick<TenantContext, "orgId">,
  input: { connectionId: string; tool: string; arguments: Record<string, unknown> },
): Promise<unknown> {
  const { row, creds } = await loadMcp(deps.db, tenant, input.connectionId);
  if (!mcpToolsOf(row).some((t) => t.name === input.tool)) {
    throw new Error(`El servidor «${row.label}» no ofrece la herramienta «${input.tool}».`);
  }
  return callMcpTool(deps, creds, input.tool, input.arguments);
}
