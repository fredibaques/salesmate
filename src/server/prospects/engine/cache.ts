import { eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { webPages } from "../../db/schema";
import { withSystem } from "../../db/tenant";
import type { Page } from "./reader";

/** Pages kept this long before reading them again. */
export const PAGE_TTL_MS = 30 * 24 * 3600_000;
/** HTML kept per page: enough for its links. */
const HTML_CAP = 200_000;

export type PageCache = {
  get(url: string): Promise<Page | null>;
  set(url: string, page: Page): Promise<void>;
};

/** The shared cache of public pages in the database (web_pages). */
export function dbPageCache(db: Db, now: () => number = Date.now): PageCache {
  return {
    async get(url) {
      const [row] = await withSystem(db, (tx) => tx.select().from(webPages).where(eq(webPages.url, url)));
      if (!row || now() - row.fetchedAt.getTime() > PAGE_TTL_MS) return null;
      return {
        url: row.finalUrl,
        title: row.title,
        text: row.text,
        html: row.html,
        links: row.links,
        viaJina: row.viaJina,
        cached: true,
      };
    },
    async set(url, page) {
      const values = {
        finalUrl: page.url,
        title: page.title.slice(0, 500),
        text: page.text.slice(0, 100_000),
        html: page.html.slice(0, HTML_CAP),
        links: page.links.slice(0, 500),
        viaJina: Boolean(page.viaJina),
        fetchedAt: new Date(now()),
      };
      await withSystem(db, (tx) =>
        tx
          .insert(webPages)
          .values({ url, ...values })
          .onConflictDoUpdate({ target: webPages.url, set: values }),
      );
    },
  };
}
