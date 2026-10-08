import { eq } from "drizzle-orm";
import { connectionCapabilities, openConnection, type ConnectorDeps } from "../connectors/service";
import { ConnectorError } from "../connectors/types";
import type { Db } from "../db/client";
import { connections } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { ingestDocumentText, ingestTableFile } from "./service";

/**
 * Brings a Google Doc (as a document) or a Google Sheet (as a table) into a
 * project's knowledge, through the organization's Google connections that
 * may read them. A copy: later changes in Google need importing again.
 */

export type GoogleFile = { kind: "doc" | "sheet"; id: string };

/** «https://docs.google.com/document/d/<id>/edit» → { kind: "doc", id }. */
export function parseGoogleUrl(url: string): GoogleFile | null {
  const m = url.trim().match(/docs\.google\.com\/(document|spreadsheets)\/d\/([\w-]{20,})/);
  if (!m) return null;
  return { kind: m[1] === "document" ? "doc" : "sheet", id: m[2] };
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export async function importFromGoogle(
  deps: { db: Db; connectors?: Omit<ConnectorDeps, "db"> },
  tenant: TenantContext,
  input: { projectId: string; url: string; name?: string },
): Promise<{ name: string; kind: "doc" | "sheet"; tables?: number }> {
  const file = parseGoogleUrl(input.url);
  if (!file) throw new Error("Pega el enlace de un documento de Google Docs o de una hoja de Google Sheets.");
  const capability = file.kind === "doc" ? "docs.read" : "sheets.read";
  const candidates = (
    await withTenant(deps.db, tenant, (tx) =>
      tx.select().from(connections).where(eq(connections.provider, "google")),
    )
  ).filter((c) => c.status === "active" && connectionCapabilities(c).includes(capability));
  if (!candidates.length) {
    throw new Error(
      `Conecta ${file.kind === "doc" ? "Google Docs" : "Google Sheets"} en Configuración → Conexiones para importar desde Google.`,
    );
  }

  // The file may belong to any of the connected accounts: try each.
  let lastError: unknown = null;
  for (const conn of candidates) {
    try {
      const { client } = await openConnection({ db: deps.db, ...deps.connectors }, tenant, conn.id);
      if (file.kind === "doc") {
        const doc = await client["docs.read"]!({ documentId: file.id });
        const name = input.name?.trim() || doc.title;
        await ingestDocumentText(deps.db, tenant, {
          projectId: input.projectId,
          name,
          text: doc.text,
          uri: input.url,
        });
        return { name, kind: "doc" };
      }
      const sheet = await client["sheets.read"]!({ spreadsheetId: file.id });
      const rows = sheet.rows.filter((r) => r.some((c) => c.trim()));
      if (rows.length < 2) throw new Error("La hoja está vacía o solo tiene la cabecera.");
      const name = input.name?.trim() || `${sheet.title} · ${sheet.sheetTitle}`;
      const csv = rows.map((r) => r.map(csvCell).join(",")).join("\n");
      const { tables } = await ingestTableFile(deps.db, tenant, {
        projectId: input.projectId,
        name,
        filename: `${name}.csv`,
        data: Buffer.from(csv, "utf8"),
      });
      return { name, kind: "sheet", tables: tables.length };
    } catch (err) {
      lastError = err;
      // Not visible to this account: try the next one.
      if (err instanceof ConnectorError && (err.status === 403 || err.status === 404)) continue;
      throw err;
    }
  }
  throw new Error(
    lastError instanceof ConnectorError && lastError.status === 404
      ? "No encontramos ese fichero con las cuentas de Google conectadas."
      : "Las cuentas de Google conectadas no tienen acceso a ese fichero. Compártelo con una de ellas.",
  );
}
