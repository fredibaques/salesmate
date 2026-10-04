/**
 * Target keys identify who an action reaches: `email:ana@acme.com`,
 * `domain:acme.com`, `phone:+34600111222`. They power suppression lists and
 * the cross-project cooldown.
 */

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 6) return null;
  return trimmed.startsWith("+") || trimmed.startsWith("00") ? `+${digits.replace(/^00/, "")}` : digits;
}

export function normalizeDomain(raw: string): string | null {
  const domain = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) ? domain : null;
}

export function emailTargets(emails: readonly string[]): string[] {
  const keys = new Set<string>();
  for (const raw of emails) {
    const email = normalizeEmail(raw);
    if (!email) continue;
    keys.add(`email:${email}`);
    keys.add(`domain:${email.split("@")[1]}`);
  }
  return [...keys];
}

export function phoneTargets(phones: readonly string[]): string[] {
  return phones.flatMap((p) => {
    const phone = normalizePhone(p);
    return phone ? [`phone:${phone}`] : [];
  });
}

/**
 * Keys that identify a person (not a whole company). Cooldowns use these:
 * a shared domain such as gmail.com must not link unrelated people.
 */
export function personKeys(keys: readonly string[]): string[] {
  return keys.filter((k) => k.startsWith("email:") || k.startsWith("phone:"));
}

/** Keys to look up in suppression lists: the emails/phones plus their domains. */
export function suppressionLookupKeys(
  keys: readonly string[],
): { type: "email" | "domain" | "phone"; value: string }[] {
  return keys.map((k) => {
    const [type, ...rest] = k.split(":");
    return { type: type as "email" | "domain" | "phone", value: rest.join(":") };
  });
}
