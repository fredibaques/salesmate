import { createHash } from "node:crypto";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { audit } from "../audit";
import type { Db } from "../db/client";
import {
  kbChunks,
  kbDocuments,
  knowledgeRows,
  knowledgeSources,
  knowledgeTables,
  type TableColumn,
} from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { chunkText, extractText } from "./documents";
import { foldText } from "./normalize";
import { inferTable, parseTabularFile } from "./tabular";

export type SourceRow = typeof knowledgeSources.$inferSelect;
type Reliability = "truth" | "reference";

const INSERT_BATCH = 500;

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

export async function ingestTableFile(
  db: Db,
  tenant: TenantContext,
  input: {
    projectId: string;
    name: string;
    description?: string;
    reliability: Reliability;
    filename: string;
    data: ArrayBuffer | Buffer;
  },
): Promise<{
  source: SourceRow;
  tables: { id: string; name: string; rowCount: number; columns: TableColumn[] }[];
}> {
  const sheets = await parseTabularFile(input.data, input.filename);
  const typed = sheets.map(inferTable).filter((t) => t.columns.length > 0);
  if (typed.length === 0) throw new Error("El fichero no contiene ninguna tabla con cabeceras.");

  return withTenant(db, tenant, async (tx) => {
    const [source] = await tx
      .insert(knowledgeSources)
      .values({
        orgId: tenant.orgId,
        projectId: input.projectId,
        kind: "table",
        name: input.name,
        description: input.description,
        reliability: input.reliability,
        syncMode: "snapshot",
        status: "ready",
        lastSyncedAt: new Date(),
        exposedObjects: { filename: input.filename },
        createdBy: tenant.actorId,
      })
      .returning();

    const tables = [];
    for (const table of typed) {
      const [row] = await tx
        .insert(knowledgeTables)
        .values({
          orgId: tenant.orgId,
          sourceId: source.id,
          name: table.name,
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

export async function ingestDocumentFile(
  db: Db,
  tenant: TenantContext,
  input: {
    projectId: string;
    name: string;
    description?: string;
    reliability: Reliability;
    kind?: "document" | "examples";
    filename: string;
    data: ArrayBuffer | Buffer;
  },
): Promise<{ source: SourceRow; chunks: number }> {
  const text = await extractText(input.data, input.filename);
  return ingestDocumentText(db, tenant, { ...input, text, uri: input.filename });
}

export async function ingestDocumentText(
  db: Db,
  tenant: TenantContext,
  input: {
    projectId: string;
    name: string;
    description?: string;
    reliability: Reliability;
    kind?: "document" | "examples";
    text: string;
    uri?: string;
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
        reliability: input.reliability,
        status: "ready",
        lastSyncedAt: new Date(),
        createdBy: tenant.actorId,
      })
      .returning();
    const [doc] = await tx
      .insert(kbDocuments)
      .values({
        orgId: tenant.orgId,
        sourceId: source.id,
        title: input.name,
        uri: input.uri,
        checksum: createHash("sha256").update(input.text).digest("hex"),
        charCount: input.text.length,
      })
      .returning();
    for (let i = 0; i < chunks.length; i += INSERT_BATCH) {
      await tx.insert(kbChunks).values(
        chunks.slice(i, i + INSERT_BATCH).map((content, j) => ({
          orgId: tenant.orgId,
          sourceId: source.id,
          documentId: doc.id,
          position: i + j,
          content,
          searchText: foldText(content),
        })),
      );
    }
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

export async function updateSource(
  db: Db,
  tenant: TenantContext,
  sourceId: string,
  patch: { reliability?: Reliability; validated?: boolean; name?: string },
) {
  return withTenant(db, tenant, async (tx) => {
    const [row] = await tx
      .update(knowledgeSources)
      .set({
        ...(patch.name ? { name: patch.name } : {}),
        ...(patch.reliability ? { reliability: patch.reliability } : {}),
        ...(patch.validated !== undefined
          ? patch.validated
            ? { validatedAt: new Date(), validatedBy: tenant.actorId }
            : { validatedAt: null, validatedBy: null }
          : {}),
      })
      .where(eq(knowledgeSources.id, sourceId))
      .returning();
    if (!row) throw new Error("Fuente no encontrada.");
    await audit(tx, tenant, {
      event: "knowledge.source_updated",
      projectId: row.projectId,
      entityType: "knowledge_source",
      entityId: row.id,
      data: patch,
    });
    return row;
  });
}

export async function deleteSource(db: Db, tenant: TenantContext, sourceId: string) {
  await withTenant(db, tenant, async (tx) => {
    const [row] = await tx.delete(knowledgeSources).where(eq(knowledgeSources.id, sourceId)).returning();
    if (!row) throw new Error("Fuente no encontrada.");
    await audit(tx, tenant, {
      event: "knowledge.source_deleted",
      projectId: row.projectId,
      entityType: "knowledge_source",
      entityId: row.id,
      data: { name: row.name },
    });
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
  source: { id: string; name: string; reliability: Reliability };
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
      source: { id: table.source.id, name: table.source.name, reliability: table.source.reliability },
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
  reliability: Reliability;
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
        reliability: knowledgeSources.reliability,
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
            reliability: knowledgeSources.reliability,
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
