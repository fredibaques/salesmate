import { decodeEntities, sameSite, type Page } from "./reader";

/**
 * What a company's pages say in a fixed shape, found without AI: emails,
 * phones, its tax id (CIF) and its social profiles. They go to the model as
 * hints, so it only has to pick, not hunt.
 */
export type SiteFacts = {
  emails: string[];
  phones: string[];
  taxIds: string[];
  socials: string[];
};

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi;
/** Addresses in pages that aren't anyone's mailbox (assets, tracking, examples). */
const NOT_AN_EMAIL =
  /\.(png|jpe?g|gif|webp|svg|css|js)$|@(\d+x|sentry|example|domain|email|tudominio|yourdomain|wixpress|sentry-next)\.|^(u00|x22)/i;
/** Spanish company tax ids (CIF): a letter, seven digits and a control character. */
const CIF = /\b([ABCDEFGHJNPQRSUVW])[-\s.]?(\d{7})[-\s.]?([0-9A-J])\b/g;
const SOCIAL =
  /https?:\/\/(?:[a-z]{2,3}\.)?(?:linkedin\.com\/(?:company|in|school)|instagram\.com|facebook\.com|(?:twitter|x)\.com|youtube\.com\/(?:@|c\/|channel\/|user\/)|tiktok\.com\/@)[^\s"'<>)]*/gi;

function unique(values: string[]) {
  return [...new Set(values)];
}

/** Phone numbers as written, kept when they have 9 to 13 digits (a Spanish one, or international). */
function phonesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?:\+|00)?\d[\d\s().-]{7,18}\d/g)) {
    const raw = m[0].trim();
    const digits = raw.replace(/\D/g, "");
    const national = digits.replace(/^(00)?34(?=\d{9}$)/, "");
    // Dates, postcodes, ids and prices look like this too: a Spanish number starts with 6, 7, 8 or 9.
    if (national.length === 9 && /^[6789]/.test(national)) {
      out.push(`${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`);
    } else if ((raw.startsWith("+") || raw.startsWith("00")) && digits.length >= 10 && digits.length <= 13) {
      out.push(`+${digits.replace(/^00/, "")}`);
    }
  }
  return out;
}

export function siteFacts(pages: Page[]): SiteFacts {
  const site = pages[0] ? new URL(pages[0].url).hostname : "";
  const emails: string[] = [];
  const phones: string[] = [];
  const taxIds: string[] = [];
  const socials: string[] = [];
  for (const page of pages) {
    const html = page.html;
    for (const m of html.matchAll(/href\s*=\s*["']mailto:([^"'?]+)/gi)) emails.push(decodeEntities(m[1]));
    for (const m of html.matchAll(/href\s*=\s*["']tel:([^"']+)/gi))
      phones.push(...phonesIn(decodeURIComponent(m[1])));
    emails.push(...(page.text.match(EMAIL) ?? []));
    phones.push(...phonesIn(page.text));
    for (const m of page.text.matchAll(CIF)) taxIds.push(`${m[1]}${m[2]}${m[3]}`);
    for (const m of html.matchAll(SOCIAL)) socials.push(m[0].replace(/[/?]+$/, "").replace(/&amp;/g, "&"));
  }
  const cleanEmails = unique(emails.map((e) => e.trim().toLowerCase())).filter(
    (e) => !NOT_AN_EMAIL.test(e) && e.length < 100,
  );
  // The site's own addresses first.
  const domain = (e: string) => e.split("@")[1] ?? "";
  cleanEmails.sort((a, b) => Number(sameSite(domain(b), site)) - Number(sameSite(domain(a), site)));
  return {
    emails: cleanEmails.slice(0, 8),
    phones: unique(phones).slice(0, 6),
    taxIds: unique(taxIds).slice(0, 3),
    socials: unique(socials)
      .filter((s) => !/sharer|share\?|intent\/|plugins|dialog/i.test(s))
      .slice(0, 8),
  };
}
