/** Lower-case and strip accents so "Reunión" and "reunion" match. */
export function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Stable identifier from a human label: "Precio (€)" → "precio". */
export function slugifyKey(label: string): string {
  const slug = foldText(label)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "col";
}
