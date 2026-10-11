import { z } from "zod";
import type { BaseColumn, RowKind } from "@/lib/prospect-columns";
import type { AgentRunStep } from "../../db/schema";
import type { TenantContext } from "../../db/tenant";
import { estimateCostUsd, type LlmClient, type LlmRequest } from "../../llm/client";
import { agentColumns } from "../agent-schema";
import { completeProspects, recordRowWork } from "../complete";
import { knownProspects, saveProspects } from "../service";
import {
  columnLine,
  factsBlock,
  NOT_A_COMPANY_SITE,
  pagesBlock,
  pool,
  readSite,
  SEARCH_USD,
  type EngineDeps,
} from "./engine";
import { siteFacts } from "./facts";
import { siteReader, webUrl } from "./reader";

/**
 * Finding new companies without the agent: the small model turns what the
 * table is for into a few Google searches (new ones each run), Serper runs
 * them, and every company site among the results is read (pages cached 30
 * days) and given to the small model once, which says whether it is the
 * kind of company wanted and fills the table's columns from its pages. The
 * ones that are become rows; directories, media and marketplaces are left
 * out. A row found this way costs a fraction of a cent.
 */

export type DiscoveryResult = {
  added: number;
  /** Company sites read and judged. */
  examined: number;
  /** The searches run this time (to be avoided next time). */
  queries: string[];
  costUsd: number;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  searches: number;
  pagesRead: number;
  steps: AgentRunStep[];
};

const QUERIES_PER_RUN = 6;
/** Time a candidate needs once started: none starts closer than this to the deadline. */
const CANDIDATE_MARGIN_MS = 25_000;
const CONCURRENCY = 5;

const queriesOutput = z.object({ queries: z.array(z.string()) });
const verdictOutput = z.object({
  matches: z.boolean(),
  reason: z.string(),
  companyName: z.string(),
  cells: z.array(z.object({ column: z.string(), value: z.string(), source: z.string() })),
  notFound: z.array(z.string()),
});

function textOf(response: Awaited<ReturnType<LlmClient["create"]>>): string {
  return response.content
    .filter((b): b is Extract<(typeof response.content)[number], { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
}

export async function runDiscovery(
  deps: EngineDeps & { search: NonNullable<EngineDeps["search"]> },
  actor: TenantContext,
  input: {
    base: { id: string; name: string; rowKind: RowKind; columns: BaseColumn[] };
    agentConfigId: string;
    runId: string;
    /** New rows wanted this run. */
    target: number;
    /** Epoch ms after which no new candidate is read. */
    deadline: number;
    /** What the run may still spend. */
    budgetUsd?: number;
    /** What the table is for: the project, its ideal customer and the agent's instructions. */
    brief: string;
    /** Searches run before, not to repeat them. */
    usedQueries: string[];
    country?: string;
    /** The project's own site, never a row. */
    ownSite?: string | null;
  },
): Promise<DiscoveryResult> {
  const now = deps.now ?? Date.now;
  const read = siteReader(deps.reader);
  const result: DiscoveryResult = {
    added: 0,
    examined: 0,
    queries: [],
    costUsd: 0,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    searches: 0,
    pagesRead: 0,
    steps: [],
  };
  const columns = agentColumns(input.base.columns);
  const ids = columns.map((c) => c.id);
  const ownHost = webUrl(input.ownSite)?.hostname.replace(/^www\./, "");
  const canGoOn = () =>
    result.added < input.target &&
    now() < input.deadline - CANDIDATE_MARGIN_MS &&
    (input.budgetUsd === undefined || result.costUsd < input.budgetUsd);

  /** One call to the small model; its cost goes to the run (and is returned for the row). */
  const ask = async (request: LlmRequest) => {
    const response = await deps.llm.create(request);
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
    const cost = estimateCostUsd(response.model ?? deps.llm.model, usage);
    result.costUsd += cost;
    return { text: textOf(response), cost };
  };

  // 1. New searches for what the table is for.
  const planned = await ask({
    max_tokens: 600,
    system:
      "Preparas búsquedas de Google para encontrar las webs de empresas concretas que podrían ser clientes. Cada búsqueda, de 2 a 6 palabras: el tipo de negocio y, si se sabe, la zona (p. ej. «concesionario coches ocasión Málaga»). Nada de búsquedas de directorios, listados ni noticias. Responde solo con el JSON pedido.",
    messages: [
      {
        role: "user",
        content: [
          `## Lo que se busca\n${input.brief}`,
          `Tabla: «${input.base.name}».`,
          input.usedQueries.length
            ? `## Ya buscado (no lo repitas; prueba otras zonas, sinónimos o tipos de negocio)\n${input.usedQueries.slice(-60).join("\n")}`
            : "",
          `Da ${QUERIES_PER_RUN} búsquedas distintas.`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: { queries: { type: "array", items: { type: "string" } } },
          required: ["queries"],
          additionalProperties: false,
        },
      },
    },
  });
  const used = new Set(input.usedQueries.map((q) => q.trim().toLowerCase()));
  const queries = queriesOutput
    .parse(JSON.parse(planned.text))
    .queries.map((q) => q.trim())
    .filter((q) => q && !used.has(q.toLowerCase()))
    .slice(0, QUERIES_PER_RUN);

  const seen = new Set<string>(ownHost ? [ownHost] : []);
  for (const query of queries) {
    if (!canGoOn()) break;
    result.queries.push(query);
    result.steps.push({ type: "tool_call", name: "buscar_web", input: { query } });
    let found;
    try {
      found = await deps.search({ query, country: input.country, limit: 10 });
      result.searches++;
      result.costUsd += SEARCH_USD;
    } catch (err) {
      result.steps.push({
        type: "tool_result",
        name: "buscar_web",
        output: { error: err instanceof Error ? err.message : String(err) },
        isError: true,
      });
      continue;
    }
    // 2. The companies' own sites among the results, not seen before and not in the table yet.
    const sites: { host: string; title: string }[] = [];
    for (const r of found.results) {
      const host = webUrl(r.url)?.hostname.replace(/^www\./, "");
      if (!host || seen.has(host) || NOT_A_COMPANY_SITE.test(host)) continue;
      seen.add(host);
      sites.push({ host, title: r.title });
    }
    const known = new Set(
      await knownProspects(
        deps.db,
        actor,
        input.base.id,
        sites.map((s) => ({ companyName: s.host, website: s.host })),
      ),
    );
    const fresh = sites.filter((s) => !known.has(s.host));
    result.steps.push({
      type: "tool_result",
      name: "buscar_web",
      output: { webs: sites.length, nuevas: fresh.length },
    });

    // 3. Each site read and judged once.
    await pool(fresh, deps.concurrency ?? CONCURRENCY, canGoOn, async ({ host, title }) => {
      const site = `https://${host}/`;
      let pages;
      try {
        pages = await readSite(read, site);
      } catch {
        return;
      }
      result.pagesRead += pages.filter((p) => !p.cached).length;
      if (pages.every((p) => p.text.length < 80)) return;
      result.examined++;
      const facts = siteFacts(pages);
      let verdict: z.infer<typeof verdictOutput>;
      let cost = 0;
      try {
        const answer = await ask({
          max_tokens: 1500,
          system:
            "Decides si una web es la de una empresa que encaja con lo que se busca y, si lo es, rellenas columnas de una tabla con lo que dicen sus páginas. matches=false si es un directorio, un listado, un medio, un marketplace, una web de anuncios, la de un particular o una empresa que no encaja. Solo datos que aparezcan en esas páginas, cada uno con la URL de la página de donde sale. Datos de contacto: solo los que la empresa publica para ser contactada. Responde solo con el JSON pedido.",
          messages: [
            {
              role: "user",
              content: [
                `## Lo que se busca\n${input.brief}`,
                `Web: ${site} (título en Google: «${title}»).`,
                columns.length ? `## Columnas por rellenar\n${columns.map(columnLine).join("\n")}` : "",
                factsBlock(facts) ? `Encontrado en las páginas con patrones:\n${factsBlock(facts)}` : "",
                `## Páginas de su web\n${pagesBlock(pages)}`,
              ]
                .filter(Boolean)
                .join("\n\n"),
            },
          ],
          output_config: {
            format: {
              type: "json_schema",
              schema: {
                type: "object",
                properties: {
                  matches: { type: "boolean" },
                  reason: { type: "string", description: "Por qué sí o por qué no, en una frase" },
                  companyName: { type: "string", description: "Nombre comercial de la empresa" },
                  cells: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        column: { type: "string", enum: ids.length ? ids : ["-"] },
                        value: { type: "string" },
                        source: { type: "string" },
                      },
                      required: ["column", "value", "source"],
                      additionalProperties: false,
                    },
                  },
                  notFound: { type: "array", items: { type: "string", enum: ids.length ? ids : ["-"] } },
                },
                required: ["matches", "reason", "companyName", "cells", "notFound"],
                additionalProperties: false,
              },
            },
          },
        });
        cost = answer.cost;
        verdict = verdictOutput.parse(JSON.parse(answer.text));
      } catch {
        return;
      }
      result.steps.push({
        type: "tool_result",
        name: "evaluar_web",
        output: { web: host, encaja: verdict.matches, motivo: verdict.reason },
      });
      if (!verdict.matches || !verdict.companyName.trim() || result.added >= input.target) return;

      // 4. A new row, with the source of each value; what its pages don't say is not found.
      const pageUrls = new Set(pages.map((p) => p.url));
      const fields: Record<string, string> = {};
      const fieldSources: Record<string, string> = {};
      for (const cell of verdict.cells) {
        if (!ids.includes(cell.column) || !cell.value.trim()) continue;
        fields[cell.column] = cell.value;
        fieldSources[cell.column] = pageUrls.has(cell.source) ? cell.source : pages[0].url;
      }
      const saved = await saveProspects(deps.db, actor, {
        baseId: input.base.id,
        agentConfigId: input.agentConfigId,
        runId: input.runId,
        items: [
          {
            companyName: verdict.companyName.trim(),
            website: site,
            sources: [...pageUrls].slice(0, 10),
            fields,
            fieldSources,
          },
        ],
      });
      const row = saved.added[0];
      if (!row) return;
      result.added++;
      const missing = ids.filter((id) => row.data[id] === undefined || row.data[id] === null);
      if (missing.length) {
        await completeProspects(deps.db, actor, {
          baseId: input.base.id,
          runId: input.runId,
          items: [{ id: row.id, notFound: missing }],
        });
      }
      await recordRowWork(deps.db, actor, { baseId: input.base.id, rowId: row.id, costUsd: cost });
    });
  }
  return result;
}
