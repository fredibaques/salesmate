import { z } from "zod";
import { COLUMN_TYPE_LABELS, formatCell, type BaseColumn, type RowKind } from "@/lib/prospect-columns";
import { foldText } from "../../knowledge/normalize";
import type { WebSearchResult } from "../../connectors/types";
import type { Db } from "../../db/client";
import type { AgentRunStep } from "../../db/schema";
import type { TenantContext } from "../../db/tenant";
import { estimateCostUsd, type LlmClient } from "../../llm/client";
import { completeProspects, recordRowWork, type RowToComplete } from "../complete";
import { siteFacts, type SiteFacts } from "./facts";
import { ReadError, siteReader, usefulSubpages, webUrl, type Page, type ReaderDeps } from "./reader";

/**
 * The completion engine: fills a table's empty cells row by row without an
 * agent. For each row it finds the company's site (Serper, when the row has
 * none), reads its home and the pages that usually hold the data (contact,
 * legal notice, about), picks out emails, phones and tax ids with patterns,
 * and asks the provider's small model, once, for the columns still empty,
 * each with the page it comes from. A fixed path, so a row costs a fraction
 * of a cent instead of an agent's search; the rows it can't read (no site,
 * a site that doesn't answer) are left for the agent.
 */

export type EngineDeps = {
  db: Db;
  /** The model that reads the pages: the provider's small one. */
  llm: LlmClient;
  /** Google results (Serper), to find the site of a row without one. */
  search?: (input: { query: string; country?: string; limit?: number }) => Promise<WebSearchResult>;
  reader?: ReaderDeps;
  now?: () => number;
  /** Rows worked on at once. */
  concurrency?: number;
};

export type EngineRow = {
  id: string;
  /** completed: read and answered (cells filled or marked not found); the rest are for the agent. */
  status: "completed" | "no_site" | "unreadable" | "failed";
  filled: number;
  notFound: number;
  costUsd: number;
  website: string | null;
  note?: string;
};

export type EngineResult = {
  rows: EngineRow[];
  /** Rows not started: the time ran out. */
  notStarted: string[];
  filled: number;
  notFound: number;
  costUsd: number;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  searches: number;
  pagesRead: number;
  steps: AgentRunStep[];
};

/** What a Serper search costs at the entry pack (less at volume): counted in each row's cost. */
export const SEARCH_USD = 0.001;
/** Characters of page text sent per row (about 5,000 tokens). */
const TEXT_BUDGET = 18_000;
/** Time a row needs once started (reads and the model): no new rows closer than this to the deadline. */
const ROW_MARGIN_MS = 25_000;
const CONCURRENCY = 6;

/** Sites that are about companies, not theirs: never taken as a row's website. */
const NOT_A_COMPANY_SITE =
  /(^|\.)(linkedin|facebook|instagram|twitter|x|youtube|tiktok|wikipedia|google|bing|yelp|tripadvisor|paginasamarillas|qdq|cylex|einforma|axesor|infoempresa|empresite|infocif|libreborme|iberinform|guiaempresas|eleconomista|expansion|dateas|infobel|hotfrog|europages|kompass|cronoshare|habitissimo|milanuncios|amazon|glassdoor|indeed|infojobs|trustpilot|doctoralia|pinterest)\.[a-z.]+$/i;

/** «Autos García, S.L.» → [«autos», «garcia»]: the words that should appear in its domain. */
function nameWords(name: string): string[] {
  return foldText(name)
    .toLowerCase()
    .replace(
      /\b(s\.?l\.?u?|s\.?a\.?u?|s\.?l\.?l|s\.?coop|sociedad|limitada|anonima|grupo|the|and|los|las|del|de|y)\b/g,
      " ",
    )
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
}

/** The site among the results that looks like the company's own. */
export function pickWebsite(name: string, found: WebSearchResult): string | null {
  const words = nameWords(name);
  const own = (url: string) => {
    const host = webUrl(url)?.hostname.replace(/^www\./, "");
    if (!host || NOT_A_COMPANY_SITE.test(host)) return null;
    const bare = host.split(".").slice(0, -1).join("").replace(/-/g, "");
    return words.some((w) => bare.includes(w)) ? `https://${host}` : null;
  };
  if (found.website) {
    const host = webUrl(found.website)?.hostname.replace(/^www\./, "");
    if (host && !NOT_A_COMPANY_SITE.test(host)) return `https://${host}`;
  }
  for (const r of found.results) {
    const site = own(r.url);
    if (site) return site;
  }
  return null;
}

const extraction = z.object({
  cells: z.array(z.object({ column: z.string(), value: z.string(), source: z.string() })),
  notFound: z.array(z.string()),
});

function outputSchema(columns: BaseColumn[]) {
  const ids = columns.map((c) => c.id);
  return {
    type: "object",
    properties: {
      cells: {
        type: "array",
        items: {
          type: "object",
          properties: {
            column: { type: "string", enum: ids },
            value: { type: "string" },
            source: { type: "string", description: "URL de la página donde aparece el dato" },
          },
          required: ["column", "value", "source"],
          additionalProperties: false,
        },
      },
      notFound: { type: "array", items: { type: "string", enum: ids } },
    },
    required: ["cells", "notFound"],
    additionalProperties: false,
  } as const;
}

function columnLine(c: BaseColumn): string {
  const how = [
    COLUMN_TYPE_LABELS[c.type],
    c.options?.length ? `una de: ${c.options.join(" | ")}` : "",
    c.type === "date" ? "AAAA-MM-DD" : "",
    c.type === "multi" ? "separadas por comas" : "",
    c.type === "bool" ? "«sí» o «no»" : "",
    c.type === "score" ? "de 0 a 100" : "",
  ]
    .filter(Boolean)
    .join(", ");
  return `- ${c.id} · «${c.name}» (${how})${c.instructions ? `: ${c.instructions}` : ""}`;
}

function factsBlock(f: SiteFacts): string {
  return [
    f.emails.length ? `Emails: ${f.emails.join(", ")}` : "",
    f.phones.length ? `Teléfonos: ${f.phones.join(", ")}` : "",
    f.taxIds.length ? `CIF: ${f.taxIds.join(", ")}` : "",
    f.socials.length ? `Redes: ${f.socials.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The pages' text within the budget: the home is cut first, the contact and legal pages are kept. */
function pagesBlock(pages: Page[]): string {
  const per = Math.floor(TEXT_BUDGET / pages.length);
  return pages
    .map((p) => `### ${p.url}${p.title ? ` — ${p.title}` : ""}\n${p.text.slice(0, per)}`)
    .join("\n\n");
}

async function pool<T>(items: T[], size: number, canStart: () => boolean, work: (item: T) => Promise<void>) {
  const queue = [...items];
  const skipped: T[] = [];
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
        if (!canStart()) {
          skipped.push(item, ...queue.splice(0));
          return;
        }
        await work(item);
      }
    }),
  );
  return skipped;
}

export async function runCompletionEngine(
  deps: EngineDeps,
  actor: TenantContext,
  input: {
    base: { id: string; name: string; rowKind: RowKind; columns: BaseColumn[] };
    rows: RowToComplete[];
    runId?: string;
    /** Epoch ms after which no new row starts. */
    deadline: number;
    /** What the project sells, for context (one line). */
    context?: string;
    /** Country of the search results (ISO code). */
    country?: string;
    /** The run's spending cap: no new row once it's reached. */
    budgetUsd?: number;
  },
): Promise<EngineResult> {
  const now = deps.now ?? Date.now;
  const read = siteReader(deps.reader);
  const result: EngineResult = {
    rows: [],
    notStarted: [],
    filled: 0,
    notFound: 0,
    costUsd: 0,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    searches: 0,
    pagesRead: 0,
    steps: [],
  };
  const columnsById = new Map(input.base.columns.map((c) => [c.id, c]));
  const person = input.base.rowKind === "person";

  async function completeRow(row: RowToComplete): Promise<EngineRow> {
    const label = (person ? row.personName : null) ?? row.companyName;
    const out: EngineRow = {
      id: row.id,
      status: "completed",
      filled: 0,
      notFound: 0,
      costUsd: 0,
      website: null,
    };
    const columns = row.columns.map((id) => columnsById.get(id)).filter((c): c is BaseColumn => Boolean(c));

    // 1. The company's site: the row's, or found on Google.
    let site = webUrl(row.website);
    let foundSite: string | null = null;
    if (!site && deps.search && row.companyName.trim()) {
      const query = `${row.companyName} ${person && row.personName ? "" : "web oficial"}`.trim();
      result.steps.push({ type: "tool_call", name: "buscar_web", input: { fila: label, query } });
      try {
        const found = await deps.search({ query, country: input.country, limit: 8 });
        result.searches++;
        out.costUsd += SEARCH_USD;
        foundSite = pickWebsite(row.companyName, found);
        site = webUrl(foundSite);
        result.steps.push({ type: "tool_result", name: "buscar_web", output: { web: foundSite } });
      } catch (err) {
        result.steps.push({
          type: "tool_result",
          name: "buscar_web",
          output: { error: err instanceof Error ? err.message : String(err) },
          isError: true,
        });
      }
    }
    if (!site) {
      out.status = "no_site";
      out.note = "sin web";
      return out;
    }
    out.website = site.toString();

    // 2. Its pages: the home, then contact, legal notice and about.
    let pages: Page[];
    try {
      const home = await read(site.toString());
      const more = await Promise.all(usefulSubpages(home).map((u) => read(u).catch(() => null)));
      pages = [home, ...more.filter((p): p is Page => Boolean(p))];
    } catch (err) {
      out.status = "unreadable";
      out.note = err instanceof ReadError ? err.message : "no se puede leer la web";
      result.steps.push({
        type: "tool_result",
        name: "leer_web",
        output: { fila: label, url: site.toString(), error: out.note },
        isError: true,
      });
      return out;
    }
    result.pagesRead += pages.length;
    result.steps.push({
      type: "tool_call",
      name: "leer_web",
      input: { fila: label, paginas: pages.map((p) => p.url) },
    });
    if (pages.every((p) => p.text.length < 80)) {
      out.status = "unreadable";
      out.note = "la web no muestra texto sin JavaScript";
      return out;
    }

    // 3. One question to the small model, with the patterns' findings as hints.
    const facts = siteFacts(pages);
    const known = Object.entries(row.known)
      .map(([id, v]) => {
        const c = columnsById.get(id);
        return c && v !== null && v !== undefined ? `- ${c.name}: ${formatCell(c, v)}` : "";
      })
      .filter(Boolean);
    const prompt = [
      `Fila de la tabla «${input.base.name}»: ${person && row.personName ? `${row.personName}, de ${row.companyName}` : row.companyName}${out.website ? ` (${out.website})` : ""}.`,
      input.context ? `Contexto de quien vende: ${input.context}` : "",
      known.length ? `Ya sabemos:\n${known.join("\n")}` : "",
      `Columnas por rellenar:\n${columns.map(columnLine).join("\n")}`,
      factsBlock(facts)
        ? `Encontrado en las páginas con patrones (úsalo si encaja):\n${factsBlock(facts)}`
        : "",
      `## Páginas de su web\n${pagesBlock(pages)}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const response = await deps.llm.create({
      max_tokens: 1500,
      system:
        "Rellenas columnas de una tabla de prospección con lo que dicen las páginas de la web de una empresa. Solo datos que aparezcan en esas páginas o se deduzcan directamente de ellas, cada uno con la URL de la página de donde sale (source). No inventes ni supongas. Datos de contacto: solo los que la empresa publica para ser contactada; nada personal privado. Lo que no aparezca, ponlo en notFound. Responde solo con el JSON pedido.",
      messages: [{ role: "user", content: prompt }],
      output_config: { format: { type: "json_schema", schema: outputSchema(columns) } },
    });
    const usage = {
      input: response.usage.input_tokens ?? 0,
      output: response.usage.output_tokens ?? 0,
      cacheRead: response.usage.cache_read_input_tokens ?? 0,
      cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
    };
    result.usage.input += usage.input;
    result.usage.output += usage.output;
    result.usage.cacheRead += usage.cacheRead;
    result.usage.cacheWrite += usage.cacheWrite;
    out.costUsd += estimateCostUsd(response.model ?? deps.llm.model, usage);

    const text = response.content
      .filter((b): b is Extract<(typeof response.content)[number], { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("");
    let parsed: z.infer<typeof extraction>;
    try {
      parsed = extraction.parse(JSON.parse(text));
    } catch {
      // An answer that isn't the JSON asked for won't get better by asking again: the row is answered.
      const closed = await completeProspects(deps.db, actor, {
        baseId: input.base.id,
        runId: input.runId,
        items: [{ id: row.id, notFound: row.columns }],
      });
      out.notFound = closed.notFound;
      out.note = "la IA no ha devuelto los datos";
      return out;
    }

    // 4. Saved like the agent's: checked by column, never over a value or a person's cell.
    const pageUrls = new Set(pages.map((p) => p.url));
    const fields: Record<string, unknown> = {};
    const sources: Record<string, string> = {};
    for (const cell of parsed.cells) {
      if (!row.columns.includes(cell.column) || !cell.value.trim()) continue;
      fields[cell.column] = cell.value;
      // A source not among the pages read is the home's: never one the model made up.
      sources[cell.column] = pageUrls.has(cell.source) ? cell.source : pages[0].url;
    }
    // Every column asked for gets an answer: what it didn't give, it didn't find.
    const notFound = row.columns.filter((id) => !(id in fields));
    const saved = await completeProspects(deps.db, actor, {
      baseId: input.base.id,
      runId: input.runId,
      items: [{ id: row.id, fields, sources, notFound }],
    });
    // A value that didn't fit its column: not found either, so the next batch doesn't ask again.
    const rejected = saved.fieldErrors.length
      ? Object.keys(fields).filter((id) =>
          saved.fieldErrors.some((e) => e.includes(columnsById.get(id)!.name)),
        )
      : [];
    if (rejected.length) {
      await completeProspects(deps.db, actor, {
        baseId: input.base.id,
        runId: input.runId,
        items: [{ id: row.id, notFound: rejected }],
      });
    }
    out.filled = saved.filled;
    out.notFound = saved.notFound + rejected.length;
    result.steps.push({
      type: "tool_result",
      name: "completar_fila",
      output: { fila: label, rellenadas: out.filled, noEncontradas: out.notFound },
    });
    return out;
  }

  result.notStarted = (
    await pool(
      input.rows,
      deps.concurrency ?? CONCURRENCY,
      () =>
        now() < input.deadline - ROW_MARGIN_MS &&
        (input.budgetUsd === undefined || result.costUsd < input.budgetUsd),
      async (row) => {
        let done: EngineRow;
        try {
          done = await completeRow(row);
        } catch (err) {
          done = {
            id: row.id,
            status: "failed",
            filled: 0,
            notFound: 0,
            costUsd: 0,
            website: null,
            note: err instanceof Error ? err.message : String(err),
          };
        }
        if (done.costUsd > 0 || (done.website && !row.website)) {
          await recordRowWork(deps.db, actor, {
            baseId: input.base.id,
            rowId: row.id,
            website: row.website ? null : done.website,
            costUsd: done.costUsd,
          });
        }
        result.rows.push(done);
        result.filled += done.filled;
        result.notFound += done.notFound;
        result.costUsd += done.costUsd;
      },
    )
  ).map((r) => r.id);
  return result;
}
