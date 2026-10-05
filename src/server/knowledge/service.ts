import { createHash } from "node:crypto";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { audit } from "../audit";
import type { Db } from "../db/client";
import {
  kbChunks,
  kbDocuments,
  kbFiles,
  knowledgeRows,
  knowledgeSources,
  knowledgeTables,
  type TableColumn,
} from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { chunkText, extractText } from "./documents";
import { foldText } from "./normalize";
import {
  inferTable,
  parseTabularFile,
  segmentSheet,
  tableToChunks,
  type SheetMatrix,
  type TypedTable,
} from "./tabular";

export type SourceRow = typeof knowledgeSources.$inferSelect;
type Tx = Parameters<Parameters<typeof withTenant>[2]>[0];

const INSERT_BATCH = 500;

const MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  html: "text/html",
  htm: "text/html",
};

export function mimeTypeFor(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

type UploadedFile = { filename: string; data: ArrayBuffer | Buffer };

function toBuffer(data: ArrayBuffer | Buffer): Buffer {
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

/** Stores the searchable text of a source: its full text plus the chunks the agents cite. */
async function insertDocument(
  tx: Tx,
  tenant: TenantContext,
  sourceId: string,
  input: { title: string; uri?: string; content: string; chunks: string[] },
) {
  const [doc] = await tx
    .insert(kbDocuments)
    .values({
      orgId: tenant.orgId,
      sourceId,
      title: input.title,
      uri: input.uri,
      content: input.content,
      checksum: createHash("sha256").update(input.content).digest("hex"),
      charCount: input.content.length,
    })
    .returning();
  for (let i = 0; i < input.chunks.length; i += INSERT_BATCH) {
    await tx.insert(kbChunks).values(
      input.chunks.slice(i, i + INSERT_BATCH).map((content, j) => ({
        orgId: tenant.orgId,
        sourceId,
        documentId: doc.id,
        position: i + j,
        content,
        searchText: foldText(content),
      })),
    );
  }
  return doc;
}

async function insertFile(tx: Tx, tenant: TenantContext, sourceId: string, file: UploadedFile) {
  const data = toBuffer(file.data);
  await tx.insert(kbFiles).values({
    orgId: tenant.orgId,
    sourceId,
    filename: file.filename,
    mimeType: mimeTypeFor(file.filename),
    size: data.byteLength,
    data,
  });
}

async function insertTables(tx: Tx, tenant: TenantContext, sourceId: string, typed: TypedTable[]) {
  const tables = [];
  for (const table of typed) {
    const [row] = await tx
      .insert(knowledgeTables)
      .values({
        orgId: tenant.orgId,
        sourceId,
        name: table.name,
        description: table.description,
        columns: table.columns,
        rowCount: table.rows.length,
      })
      .returning();
    for (let i = 0; i < table.rows.length; i += INSERT_BATCH) {
      await tx.insert(knowledgeRows).values(
        table.rows.slice(i, i + INSERT_BATCH).map((data, j) => ({
          orgId: tenant.orgId,
          tableId: row.id,
          rowIndex: i + j,
          data,
        })),
      );
    }
    tables.push({ id: row.id, name: row.name, rowCount: row.rowCount, columns: row.columns });
  }
  return tables;
}

/** Tables of a workbook plus the loose text around them (titles, conditions…). */
function typedTables(sheets: SheetMatrix[]): { tables: TypedTable[]; notes: string[] } {
  const parts = sheets.map(segmentSheet);
  return {
    tables: parts
      .flatMap((p) => p.tables)
      .map(inferTable)
      .filter((t) => t.columns.length > 0 && t.rows.length > 0),
    notes: parts.flatMap((p) => p.notes),
  };
}

function tableDocument(name: string, tables: TypedTable[], notes: string[]) {
  const notesText = notes.length ? `Notas de «${name}»\n${notes.map((n) => `- ${n}`).join("\n")}` : "";
  const tableChunks = tables.flatMap((t) => tableToChunks(t));
  const chunks = [...(notesText ? chunkText(notesText) : []), ...tableChunks];
  return { content: [...tableChunks, notesText].filter(Boolean).join("\n\n"), chunks };
}

export async function ingestTableFile(
  db: Db,
  tenant: TenantContext,
  input: {
    projectId: string;
    name: string;
    description?: string;
    filename: string;
    data: ArrayBuffer | Buffer;
  },
): Promise<{
  source: SourceRow;
  tables: { id: string; name: string; rowCount: number; columns: TableColumn[] }[];
}> {
  const { tables: typed, notes } = typedTables(await parseTabularFile(input.data, input.filename));
  if (typed.length === 0) throw new Error("El fichero no contiene ninguna tabla con cabeceras.");
  // A CSV has no sheet name: its table is named after the file, so use the name the person gave.
  const fileStem = input.filename.replace(/\.[^.]+$/, "");
  for (const t of typed) if (t.name === fileStem) t.name = input.name;

  return withTenant(db, tenant, async (tx) => {
    const [source] = await tx
      .insert(knowledgeSources)
      .values({
        orgId: tenant.orgId,
        projectId: input.projectId,
        kind: "table",
        name: input.name,
        description: input.description,
        syncMode: "snapshot",
        status: "ready",
        lastSyncedAt: new Date(),
        exposedObjects: { filename: input.filename, notes },
        createdBy: tenant.actorId,
      })
      .returning();
    const tables = await insertTables(tx, tenant, source.id, typed);
    await insertDocument(tx, tenant, source.id, {
      title: input.name,
      uri: input.filename,
      ...tableDocument(input.name, typed, notes),
    });
    await insertFile(tx, tenant, source.id, input);
    await audit(tx, tenant, {
      event: "knowledge.source_added",
      projectId: input.projectId,
      entityType: "knowledge_source",
      entityId: source.id,
      data: {
        kind: "table",
        name: input.name,
        tables: tables.map((t) => ({ name: t.name, rows: t.rowCount })),
      },
    });
    return { source, tables };
  });
}

/**
 * Re-reads a table source from its original file (or, for sources uploaded
 * before files were kept, from the stored rows) with the current parser.
 */
export async function reprocessTableSource(db: Db, tenant: TenantContext, sourceId: string) {
  return withTenant(db, tenant, async (tx) => {
    const [source] = await tx.select().from(knowledgeSources).where(eq(knowledgeSources.id, sourceId));
    if (!source || source.kind !== "table") throw new Error("Tabla no encontrada.");
    const [file] = await tx.select().from(kbFiles).where(eq(kbFiles.sourceId, sourceId));
    let sheets: SheetMatrix[];
    if (file) {
      sheets = await parseTabularFile(file.data, file.filename);
    } else {
      const old = await tx.select().from(knowledgeTables).where(eq(knowledgeTables.sourceId, sourceId));
      sheets = [];
      for (const t of old) {
        const rows = await tx
          .select({ data: knowledgeRows.data })
          .from(knowledgeRows)
          .where(eq(knowledgeRows.tableId, t.id))
          .orderBy(asc(knowledgeRows.rowIndex));
        sheets.push({
          name: t.name,
          rows: [t.columns.map((c) => c.label), ...rows.map((r) => t.columns.map((c) => r.data[c.key]))],
        });
      }
    }
    const { tables: typed, notes } = typedTables(sheets);
    if (typed.length === 0) throw new Error("El fichero no contiene ninguna tabla con cabeceras.");
    await tx.delete(knowledgeTables).where(eq(knowledgeTables.sourceId, sourceId));
    await tx.delete(kbDocuments).where(eq(kbDocuments.sourceId, sourceId));
    const tables = await insertTables(tx, tenant, sourceId, typed);
    await insertDocument(tx, tenant, sourceId, {
      title: source.name,
      uri: file?.filename,
      ...tableDocument(source.name, typed, notes),
    });
    await tx
      .update(knowledgeSources)
      .set({ lastSyncedAt: new Date(), exposedObjects: { ...source.exposedObjects, notes } })
      .where(eq(knowledgeSources.id, sourceId));
    return tables;
  });
}

export async function ingestDocumentFile(
  db: Db,
  tenant: TenantContext,
  input: {
    projectId: string;
    name: string;
    description?: string;
    kind?: "document" | "examples";
    filename: string;
    data: ArrayBuffer | Buffer;
  },
): Promise<{ source: SourceRow; chunks: number }> {
  const text = await extractText(input.data, input.filename);
  return ingestDocumentText(db, tenant, {
    ...input,
    text,
    uri: input.filename,
    file: { filename: input.filename, data: input.data },
  });
}

export async function ingestDocumentText(
  db: Db,
  tenant: TenantContext,
  input: {
    projectId: string;
    name: string;
    description?: string;
    kind?: "document" | "examples";
    text: string;
    uri?: string;
    file?: UploadedFile;
  },
): Promise<{ source: SourceRow; chunks: number }> {
  const chunks = chunkText(input.text);
  if (chunks.length === 0) throw new Error("No se ha podido extraer texto del documento.");
  return withTenant(db, tenant, async (tx) => {
    const [source] = await tx
      .insert(knowledgeSources)
      .values({
        orgId: tenant.orgId,
        projectId: input.projectId,
        kind: input.kind ?? "document",
        name: input.name,
        description: input.description,
        status: "ready",
        lastSyncedAt: new Date(),
        exposedObjects: input.file ? { filename: input.file.filename } : {},
        createdBy: tenant.actorId,
      })
      .returning();
    await insertDocument(tx, tenant, source.id, {
      title: input.name,
      uri: input.uri,
      content: input.text,
      chunks,
    });
    if (input.file) await insertFile(tx, tenant, source.id, input.file);
    await audit(tx, tenant, {
      event: "knowledge.source_added",
      projectId: input.projectId,
      entityType: "knowledge_source",
      entityId: source.id,
      data: { kind: input.kind ?? "document", name: input.name, chunks: chunks.length },
    });
    return { source, chunks: chunks.length };
  });
}

export async function renameSource(db: Db, tenant: TenantContext, sourceId: string, name: string) {
  if (!name.trim()) throw new Error("Escribe un nombre.");
  return withTenant(db, tenant, async (tx) => {
    const [row] = await tx
      .update(knowledgeSources)
      .set({ name: name.trim() })
      .where(eq(knowledgeSources.id, sourceId))
      .returning();
    if (!row) throw new Error("Fuente no encontrada.");
    await audit(tx, tenant, {
      event: "knowledge.source_updated",
      projectId: row.projectId,
      entityType: "knowledge_source",
      entityId: row.id,
      data: { name: row.name },
    });
    return row;
  });
}

export async function deleteSource(db: Db, tenant: TenantContext, sourceId: string) {
  return withTenant(db, tenant, async (tx) => {
    const [row] = await tx.delete(knowledgeSources).where(eq(knowledgeSources.id, sourceId)).returning();
    if (!row) throw new Error("Fuente no encontrada.");
    await audit(tx, tenant, {
      event: "knowledge.source_deleted",
      projectId: row.projectId,
      entityType: "knowledge_source",
      entityId: row.id,
      data: { name: row.name },
    });
    return row;
  });
}

// ---------------------------------------------------------------------------
// Reading a source back (detail page)
// ---------------------------------------------------------------------------

export async function getSourceDetail(db: Db, tenant: Pick<TenantContext, "orgId">, sourceId: string) {
  return withTenant(db, tenant, async (tx) => {
    const [source] = await tx.select().from(knowledgeSources).where(eq(knowledgeSources.id, sourceId));
    if (!source) return null;
    const [file] = await tx
      .select({ filename: kbFiles.filename, mimeType: kbFiles.mimeType, size: kbFiles.size })
      .from(kbFiles)
      .where(eq(kbFiles.sourceId, sourceId));
    const tables = await tx
      .select()
      .from(knowledgeTables)
      .where(eq(knowledgeTables.sourceId, sourceId))
      .orderBy(asc(knowledgeTables.createdAt));
    const docs = await tx
      .select({ id: kbDocuments.id, content: kbDocuments.content })
      .from(kbDocuments)
      .where(eq(kbDocuments.sourceId, sourceId));
    let text = docs.map((d) => d.content ?? "").join("\n\n");
    if (!text && docs.length > 0 && source.kind !== "table") {
      // Uploaded before the full text was kept: rebuild it from the chunks.
      const chunks = await tx
        .select({ content: kbChunks.content })
        .from(kbChunks)
        .where(eq(kbChunks.sourceId, sourceId))
        .orderBy(asc(kbChunks.position));
      text = chunks.map((c) => c.content).join("\n\n");
    }
    return { source, file: file ?? null, tables, text };
  });
}

export async function getSourceFile(db: Db, tenant: Pick<TenantContext, "orgId">, sourceId: string) {
  return withTenant(db, tenant, async (tx) => {
    const [file] = await tx.select().from(kbFiles).where(eq(kbFiles.sourceId, sourceId));
    return file ?? null;
  });
}

// ---------------------------------------------------------------------------
// table.query
// ---------------------------------------------------------------------------

export const tableQuerySchema = z.object({
  tableId: z.string().uuid(),
  filters: z
    .array(
      z.object({
        column: z.string(),
        op: z.enum(["eq", "neq", "lt", "lte", "gt", "gte", "contains", "in"]),
        value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]),
      }),
    )
    .default([]),
  orderBy: z.object({ column: z.string(), direction: z.enum(["asc", "desc"]).default("asc") }).optional(),
  limit: z.number().int().min(1).max(200).default(50),
});
export type TableQuery = z.input<typeof tableQuerySchema>;

export type TableQueryResult = {
  table: { id: string; name: string; sourceId: string; columns: TableColumn[] };
  source: { id: string; name: string };
  rows: { id: string; rowIndex: number; data: Record<string, unknown> }[];
};

function columnExpr(column: TableColumn): SQL {
  const field = sql`${knowledgeRows.data} ->> ${column.key}`;
  if (column.type === "number" || column.type === "integer") return sql`(${field})::numeric`;
  if (column.type === "boolean") return sql`(${field})::boolean`;
  return field;
}

/** Structured lookup over a knowledge table. Values are always bound parameters. */
export async function queryTable(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  raw: TableQuery,
): Promise<TableQueryResult> {
  const query = tableQuerySchema.parse(raw);
  return withTenant(db, tenant, async (tx) => {
    const [table] = await tx
      .select({ table: knowledgeTables, source: knowledgeSources })
      .from(knowledgeTables)
      .innerJoin(knowledgeSources, eq(knowledgeSources.id, knowledgeTables.sourceId))
      .where(eq(knowledgeTables.id, query.tableId));
    if (!table) throw new Error("Tabla no encontrada.");
    const byKey = new Map(table.table.columns.map((c) => [c.key, c]));
    const col = (key: string) => {
      const c = byKey.get(key);
      if (!c) throw new Error(`Columna desconocida: ${key}. Disponibles: ${[...byKey.keys()].join(", ")}`);
      return c;
    };

    const conditions: SQL[] = [eq(knowledgeRows.tableId, query.tableId)];
    for (const f of query.filters) {
      const c = col(f.column);
      const expr = columnExpr(c);
      const numeric = c.type === "number" || c.type === "integer";
      const text = c.type === "text";
      switch (f.op) {
        case "eq":
          conditions.push(text ? sql`lower(${expr}) = lower(${String(f.value)})` : sql`${expr} = ${f.value}`);
          break;
        case "neq":
          conditions.push(
            text ? sql`lower(${expr}) <> lower(${String(f.value)})` : sql`${expr} <> ${f.value}`,
          );
          break;
        case "lt":
          conditions.push(sql`${expr} < ${numeric ? Number(f.value) : String(f.value)}`);
          break;
        case "lte":
          conditions.push(sql`${expr} <= ${numeric ? Number(f.value) : String(f.value)}`);
          break;
        case "gt":
          conditions.push(sql`${expr} > ${numeric ? Number(f.value) : String(f.value)}`);
          break;
        case "gte":
          conditions.push(sql`${expr} >= ${numeric ? Number(f.value) : String(f.value)}`);
          break;
        case "contains":
          conditions.push(sql`${knowledgeRows.data} ->> ${c.key} ilike ${`%${String(f.value)}%`}`);
          break;
        case "in": {
          const values = (Array.isArray(f.value) ? f.value : [f.value]).map(String);
          conditions.push(
            sql`lower(${knowledgeRows.data} ->> ${c.key}) in (${sql.join(
              values.map((v) => sql`lower(${v})`),
              sql`, `,
            )})`,
          );
          break;
        }
      }
    }

    const order = query.orderBy
      ? (query.orderBy.direction === "desc" ? desc : asc)(columnExpr(col(query.orderBy.column)))
      : asc(knowledgeRows.rowIndex);

    const rows = await tx
      .select({ id: knowledgeRows.id, rowIndex: knowledgeRows.rowIndex, data: knowledgeRows.data })
      .from(knowledgeRows)
      .where(and(...conditions))
      .orderBy(order)
      .limit(query.limit);

    return {
      table: {
        id: table.table.id,
        name: table.table.name,
        sourceId: table.source.id,
        columns: table.table.columns,
      },
      source: { id: table.source.id, name: table.source.name },
      rows,
    };
  });
}

// ---------------------------------------------------------------------------
// kb.search
// ---------------------------------------------------------------------------

export type SearchHit = {
  chunkId: string;
  sourceId: string;
  sourceName: string;
  sourceKind: SourceRow["kind"];
  documentTitle: string;
  position: number;
  content: string;
  rank: number;
};

/** Full-text search over a project's documents (accent-insensitive). */
export async function searchKnowledge(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  input: { projectId: string; query: string; limit?: number },
): Promise<SearchHit[]> {
  const folded = foldText(input.query).trim();
  if (!folded) return [];
  return withTenant(db, tenant, async (tx) => {
    const tsquery = sql`websearch_to_tsquery('simple', ${folded})`;
    const rank = sql<number>`ts_rank_cd(${kbChunks.tsv}, ${tsquery})`;
    let rows = await tx
      .select({
        chunkId: kbChunks.id,
        sourceId: knowledgeSources.id,
        sourceName: knowledgeSources.name,
        sourceKind: knowledgeSources.kind,
        documentTitle: kbDocuments.title,
        position: kbChunks.position,
        content: kbChunks.content,
        rank,
      })
      .from(kbChunks)
      .innerJoin(knowledgeSources, eq(knowledgeSources.id, kbChunks.sourceId))
      .innerJoin(kbDocuments, eq(kbDocuments.id, kbChunks.documentId))
      .where(and(eq(knowledgeSources.projectId, input.projectId), sql`${kbChunks.tsv} @@ ${tsquery}`))
      .orderBy(desc(rank))
      .limit(input.limit ?? 8);

    if (rows.length === 0) {
      // Fall back to "any word" matching when the full query has no exact hit.
      const words = folded.split(/\s+/).filter((w) => w.length > 2);
      if (words.length > 1) {
        const anyQuery = sql`to_tsquery('simple', ${words
          .map((w) => w.replace(/[^a-z0-9]/g, ""))
          .filter(Boolean)
          .join(" | ")})`;
        const anyRank = sql<number>`ts_rank_cd(${kbChunks.tsv}, ${anyQuery})`;
        rows = await tx
          .select({
            chunkId: kbChunks.id,
            sourceId: knowledgeSources.id,
            sourceName: knowledgeSources.name,
            sourceKind: knowledgeSources.kind,
            documentTitle: kbDocuments.title,
            position: kbChunks.position,
            content: kbChunks.content,
            rank: anyRank,
          })
          .from(kbChunks)
          .innerJoin(knowledgeSources, eq(knowledgeSources.id, kbChunks.sourceId))
          .innerJoin(kbDocuments, eq(kbDocuments.id, kbChunks.documentId))
          .where(and(eq(knowledgeSources.projectId, input.projectId), sql`${kbChunks.tsv} @@ ${anyQuery}`))
          .orderBy(desc(anyRank))
          .limit(input.limit ?? 8);
      }
    }
    return rows.map((r) => ({ ...r, rank: Number(r.rank) }));
  });
}
