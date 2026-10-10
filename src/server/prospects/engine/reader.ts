import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Reads public web pages for the completion engine: a plain HTTP request,
 * the HTML turned into text, and the links of the page. Only public http(s)
 * addresses (no private networks, no other ports), redirects checked one by
 * one, a size and time cap, and the site's robots.txt respected.
 */

export type ReaderDeps = {
  fetch?: typeof fetch;
  /** The addresses a host resolves to (DNS by default). */
  resolve?: (host: string) => Promise<string[]>;
  /** Jina Reader key: renders pages that need JavaScript when our read comes back empty. */
  jinaApiKey?: string;
};

export type Page = {
  url: string;
  title: string;
  text: string;
  html: string;
  links: { url: string; text: string }[];
  /** Read through Jina (a paid read) rather than directly. */
  viaJina?: boolean;
};

export class ReadError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_url" | "blocked" | "robots" | "http" | "not_html" | "timeout" | "network",
  ) {
    super(message);
  }
}

const USER_AGENT = "Mozilla/5.0 (compatible; SalesMateBot/1.0; +https://salesmate.app/bot)";
const TIMEOUT_MS = 8_000;
const MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 4;
/** Below this much text a page probably needs JavaScript to show anything. */
const THIN_TEXT = 300;

/** «autosgarcia.es» → «https://autosgarcia.es/»; null when it isn't a public web address. */
export function webUrl(raw: string | null | undefined): URL | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    if (url.port && url.port !== "80" && url.port !== "443") return null;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return null;
    if (!isIP(host.replace(/^\[|\]$/g, "")) && !host.includes(".")) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

/** Whether an IP address is on the public internet (not loopback, private, link-local…). */
export function isPublicAddress(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  return !(v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6));
}

async function defaultResolve(host: string): Promise<string[]> {
  return (await lookup(host, { all: true })).map((a) => a.address);
}

async function assertPublic(url: URL, deps: ReaderDeps) {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : await (deps.resolve ?? defaultResolve)(host).catch(() => []);
  if (!addresses.length) throw new ReadError(`No existe el dominio ${host}.`, "network");
  if (!addresses.every(isPublicAddress))
    throw new ReadError(`${host} no es una dirección pública.`, "blocked");
}

/** GET with redirects followed by hand (each hop checked), a time limit and a size cap. */
async function safeGet(url: URL, deps: ReaderDeps, accept: string): Promise<{ url: URL; res: Response }> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(current, deps);
    let res: Response;
    try {
      res = await (deps.fetch ?? fetch)(current, {
        redirect: "manual",
        headers: { "User-Agent": USER_AGENT, Accept: accept, "Accept-Language": "es,en;q=0.8" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new ReadError(
        timeout ? `${current.hostname} no responde.` : `No se puede abrir ${current.hostname}.`,
        timeout ? "timeout" : "network",
      );
    }
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return { url: current, res };
    const next = webUrl(new URL(location, current).toString());
    if (!next) throw new ReadError(`${current.hostname} redirige a una dirección no válida.`, "blocked");
    current = next;
  }
  throw new ReadError(`${url.hostname} redirige demasiadas veces.`, "http");
}

async function readBody(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (size >= MAX_BYTES) {
      await reader.cancel();
      break;
    }
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c.subarray(0, Math.min(c.byteLength, size - at)), at);
    at += c.byteLength;
    if (at >= size) break;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

// ---- robots.txt ---------------------------------------------------------------

type Rules = { allow: string[]; disallow: string[] };

/** The rules of a robots.txt for us (our own group, else `*`). */
export function parseRobots(body: string): Rules {
  const groups: { agents: string[]; rules: Rules }[] = [];
  let current: { agents: string[]; rules: Rules } | null = null;
  let lastWasAgent = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: { allow: [], disallow: [] } };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current || !value) continue;
    if (key === "allow") current.rules.allow.push(value);
    if (key === "disallow") current.rules.disallow.push(value);
  }
  const ours = groups.find((g) => g.agents.some((a) => a.includes("salesmatebot")));
  return (ours ?? groups.find((g) => g.agents.includes("*")))?.rules ?? { allow: [], disallow: [] };
}

function matches(path: string, rule: string): boolean {
  const pattern = rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${pattern.endsWith("\\$") ? `${pattern.slice(0, -2)}$` : pattern}`).test(path);
}

/** Whether the rules let us read a path: the longest matching rule wins, allow on a tie. */
export function robotsAllow(rules: Rules, path: string): boolean {
  const longest = (list: string[]) =>
    Math.max(-1, ...list.filter((r) => matches(path, r)).map((r) => r.length));
  return longest(rules.allow) >= longest(rules.disallow);
}

/** Reads one site's pages, remembering its robots.txt. */
export function siteReader(deps: ReaderDeps = {}) {
  const robots = new Map<string, Promise<Rules>>();
  const rulesFor = (url: URL) => {
    const key = url.origin;
    if (!robots.has(key)) {
      robots.set(
        key,
        (async () => {
          try {
            const { res } = await safeGet(new URL("/robots.txt", url), deps, "text/plain");
            return res.ok
              ? parseRobots((await readBody(res)).slice(0, 200_000))
              : { allow: [], disallow: [] };
          } catch {
            return { allow: [], disallow: [] };
          }
        })(),
      );
    }
    return robots.get(key)!;
  };

  return async function read(raw: string): Promise<Page> {
    const url = webUrl(raw);
    if (!url) throw new ReadError(`«${raw}» no es una dirección web válida.`, "invalid_url");
    if (!robotsAllow(await rulesFor(url), url.pathname + url.search)) {
      throw new ReadError(`${url.hostname} no permite leer esa página (robots.txt).`, "robots");
    }
    const { url: final, res } = await safeGet(url, deps, "text/html,application/xhtml+xml,text/plain;q=0.8");
    if (!res.ok) {
      // Sites that turn away anything that isn't a browser: Jina reads them like one.
      if ([401, 403, 429, 503].includes(res.status) && deps.jinaApiKey) {
        const rendered = await readWithJina(final, deps).catch(() => null);
        if (rendered && rendered.length >= THIN_TEXT) {
          return { url: final.toString(), title: "", text: rendered, html: "", links: [], viaJina: true };
        }
      }
      throw new ReadError(`${final.hostname} responde ${res.status}.`, "http");
    }
    const type = res.headers.get("content-type") ?? "";
    if (type && !/html|text\/plain/i.test(type))
      throw new ReadError(`${final.href} no es una página.`, "not_html");
    const html = await readBody(res);
    const page = parseHtml(html, final);
    if (page.text.length < THIN_TEXT && deps.jinaApiKey) {
      const rendered = await readWithJina(final, deps).catch(() => null);
      if (rendered && rendered.length > page.text.length) return { ...page, text: rendered, viaJina: true };
    }
    return page;
  };
}

/** A page that needs JavaScript, rendered by Jina Reader (paid per token). */
async function readWithJina(url: URL, deps: ReaderDeps): Promise<string> {
  const res = await (deps.fetch ?? fetch)(`https://r.jina.ai/${url.href}`, {
    headers: { Authorization: `Bearer ${deps.jinaApiKey}`, "X-Return-Format": "text" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new ReadError(`Jina responde ${res.status}.`, "http");
  return (await res.text()).slice(0, 100_000).trim();
}

// ---- HTML → text ----------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  aacute: "á",
  eacute: "é",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  ntilde: "ñ",
  Aacute: "Á",
  Eacute: "É",
  Iacute: "Í",
  Oacute: "Ó",
  Uacute: "Ú",
  Ntilde: "Ñ",
  uuml: "ü",
  ccedil: "ç",
  ordm: "º",
  ordf: "ª",
  euro: "€",
  copy: "©",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code] ?? whole;
  });
}

/** The text, title and links of an HTML page. */
export function parseHtml(html: string, url: URL): Page {
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const links: Page["links"] = [];
  for (const m of html.matchAll(/<a\s[^>]*href\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeEntities(m[1].trim());
    if (/^(mailto|tel|javascript):/i.test(href)) continue;
    try {
      links.push({
        url: new URL(href, url).toString(),
        text: decodeEntities(m[2].replace(/<[^>]+>/g, " "))
          .replace(/\s+/g, " ")
          .trim(),
      });
    } catch {
      // Not a URL: skip it.
    }
  }
  const text = decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(
        /<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|\/header|\/footer|\/address)[^>]*>/gi,
        "\n",
      )
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { url: url.toString(), title, text, html, links };
}

/** Whether two hosts are the same site (with or without www). */
export function sameSite(a: string, b: string): boolean {
  const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");
  return bare(a) === bare(b);
}

const SUBPAGES: [RegExp, number][] = [
  [/contact|contacto|contacta|donde-estamos|localiza/i, 5],
  [/aviso[-_]?legal|legal[-_]?notice|impressum|imprint|informacion[-_]?legal/i, 4],
  [/quienes[-_]?somos|sobre[-_]?nosotros|nosotros|about|empresa|company|la[-_]?empresa/i, 3],
  [/equipo|team|staff|personas/i, 2],
];

/** The pages of a site that usually hold contact and company data, best first. */
export function usefulSubpages(page: Page, limit = 3): string[] {
  const home = new URL(page.url);
  const scored = new Map<string, number>();
  for (const link of page.links) {
    let url: URL;
    try {
      url = new URL(link.url);
    } catch {
      continue;
    }
    if (!sameSite(url.hostname, home.hostname) || url.pathname === home.pathname) continue;
    if (/\.(pdf|jpe?g|png|gif|webp|zip|docx?|xlsx?)$/i.test(url.pathname)) continue;
    url.hash = "";
    const hay = `${url.pathname} ${link.text}`;
    const score = Math.max(0, ...SUBPAGES.filter(([re]) => re.test(hay)).map(([, s]) => s));
    if (score > (scored.get(url.toString()) ?? 0)) scored.set(url.toString(), score);
  }
  return [...scored.entries()]
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([u]) => u);
}
