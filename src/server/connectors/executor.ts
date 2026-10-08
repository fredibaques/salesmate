import { eq } from "drizzle-orm";
import { identities } from "../db/schema";
import { withTenant } from "../db/tenant";
import type {
  CalendarBookPayload,
  CrmNotePayload,
  CrmTaskPayload,
  CrmUpsertContactPayload,
  EmailPayload,
  McpCallPayload,
  NotifyEmailPayload,
  NotifySlackPayload,
  TableExportPayload,
  TaskPayload,
  WhatsappPayload,
} from "../gateway/definitions";
import { markExported, tableForExport } from "../prospects/service";
import type { ActionExecutor, ActionRow } from "../gateway/gateway";
import { callStoredMcpTool, type McpDeps } from "./mcp";
import { markConnectionError, openConnection, type ConnectorDeps } from "./service";
import { ConnectorError, type Capabilities, type Capability, type ConnectorClient } from "./types";

function require<C extends Capability>(client: ConnectorClient, capability: C): Capabilities[C] {
  const fn = client[capability];
  if (!fn) throw new Error(`La conexión no ofrece la capacidad «${capability}».`);
  return fn as Capabilities[C];
}

/** Executes gateway actions through the stored connections. */
export class ConnectorExecutor implements ActionExecutor {
  constructor(private readonly deps: ConnectorDeps & { mcp?: McpDeps }) {}

  async execute({ orgId, action }: { orgId: string; action: ActionRow }): Promise<Record<string, unknown>> {
    if (!action.connectionId) throw new Error("La acción no tiene conexión asignada.");
    const tenant = { orgId };
    if (action.type === "mcp.call_tool") {
      const p = action.payload as McpCallPayload;
      const result = await callStoredMcpTool({ db: this.deps.db, ...this.deps.mcp }, tenant, {
        connectionId: action.connectionId,
        tool: p.tool,
        arguments: p.arguments,
      });
      return { result };
    }
    const { connection, client } = await openConnection(this.deps, tenant, action.connectionId);

    try {
      if (action.type === "table.export") return await this.exportTable(client, tenant, action);
      if (action.type === "task.create") {
        const p = action.payload as TaskPayload;
        const target =
          (connection.metadata as { taskTarget?: { id?: string } | null })?.taskTarget?.id ?? null;
        return await require(client, "task.create")({ title: p.title, body: p.body, target });
      }
      return await this.dispatch(client, tenant, action);
    } catch (err) {
      // Authentication problems disable the connection until someone reconnects it.
      if (err instanceof ConnectorError && (err.status === 401 || err.status === 403)) {
        await markConnectionError(this.deps, tenant, action.connectionId, err.message);
      }
      throw err;
    }
  }

  /** Reads the table now and writes it to the tool; new rows become «exported». */
  private async exportTable(client: ConnectorClient, tenant: { orgId: string }, action: ActionRow) {
    const p = action.payload as TableExportPayload;
    const table = await tableForExport(this.deps.db, tenant, p.baseId, p.include);
    if (!table.rows.length) return { url: null, count: 0 };
    const result = await require(client, "table.export")({
      name: table.name,
      header: table.header,
      rows: table.rows,
      target: p.target,
    });
    // Only the rows that went out count as exported (tools that write one per row stop at a cap).
    const sent = new Set(table.ids.slice(0, result.count));
    await markExported(
      this.deps.db,
      { orgId: tenant.orgId, actorType: action.actorType, actorId: action.actorId },
      {
        baseId: p.baseId,
        projectId: table.projectId,
        ids: table.pendingIds.filter((id) => sent.has(id)),
        count: result.count,
        destination: p.destination,
      },
    );
    return result;
  }

  private async identity(tenant: { orgId: string }, identityId: string) {
    const row = await withTenant(this.deps.db, tenant, async (tx) => {
      const [found] = await tx.select().from(identities).where(eq(identities.id, identityId));
      return found;
    });
    if (!row) throw new Error("Identidad no encontrada.");
    return row;
  }

  private async dispatch(client: ConnectorClient, tenant: { orgId: string }, action: ActionRow) {
    switch (action.type) {
      case "whatsapp.send": {
        const p = action.payload as WhatsappPayload;
        return await require(client, "whatsapp.send")({ to: p.to, body: p.body });
      }
      case "notify.slack":
        return await require(client, "notify.slack")({ text: (action.payload as NotifySlackPayload).text });
      case "notify.email": {
        const p = action.payload as NotifyEmailPayload;
        const from = await this.identity(tenant, p.identityId);
        return await require(client, "email.send")({
          from: { address: from.address, name: from.displayName },
          to: p.to,
          cc: [],
          subject: p.subject,
          body: p.body,
        });
      }
      case "email.send":
      case "email.create_draft": {
        const p = action.payload as EmailPayload;
        const from = await this.identity(tenant, p.identityId);
        const email = {
          from: { address: from.address, name: from.displayName },
          to: p.to,
          cc: p.cc,
          subject: p.subject,
          body: p.body,
          threadId: p.threadId,
          inReplyToMessageId: p.inReplyToMessageId,
        };
        return action.type === "email.send"
          ? await require(client, "email.send")(email)
          : await require(client, "email.create_draft")(email);
      }
      case "calendar.book": {
        const p = action.payload as CalendarBookPayload;
        const calendar = await this.identity(tenant, p.identityId);
        return await require(client, "calendar.book")({
          calendarId: calendar.address,
          start: p.start,
          end: p.end,
          title: p.title,
          description: p.description,
          location: p.location,
          attendees: p.attendees,
        });
      }
      case "crm.upsert_contact":
        return await require(client, "crm.upsert_contact")(action.payload as CrmUpsertContactPayload);
      case "crm.create_task":
        return await require(client, "crm.create_task")(action.payload as CrmTaskPayload);
      case "crm.log_note":
        return await require(client, "crm.log_note")(action.payload as CrmNotePayload);
      default:
        throw new Error(`Sin ejecutor para «${action.type}».`);
    }
  }
}
