/**
 * Ready-made answers for the project and its sales profile, so people pick
 * instead of typing. Free text stays possible wherever a list can't cover
 * every business.
 */

export const TIMEZONES: { value: string; label: string }[] = [
  { value: "Europe/Madrid", label: "España (península y Baleares)" },
  { value: "Atlantic/Canary", label: "España (Canarias)" },
  { value: "Europe/Lisbon", label: "Portugal" },
  { value: "Europe/London", label: "Reino Unido e Irlanda" },
  { value: "Europe/Paris", label: "Francia" },
  { value: "Europe/Berlin", label: "Alemania" },
  { value: "Europe/Rome", label: "Italia" },
  { value: "America/Mexico_City", label: "México (centro)" },
  { value: "America/Bogota", label: "Colombia" },
  { value: "America/Lima", label: "Perú" },
  { value: "America/Santiago", label: "Chile" },
  { value: "America/Argentina/Buenos_Aires", label: "Argentina" },
  { value: "America/New_York", label: "EE. UU. (este)" },
  { value: "America/Los_Angeles", label: "EE. UU. (oeste)" },
  { value: "UTC", label: "UTC" },
];

export const LANGUAGES: { value: string; label: string }[] = [
  { value: "es", label: "Español" },
  { value: "en", label: "Inglés" },
  { value: "ca", label: "Catalán" },
  { value: "eu", label: "Euskera" },
  { value: "gl", label: "Gallego" },
  { value: "pt", label: "Portugués" },
  { value: "fr", label: "Francés" },
  { value: "de", label: "Alemán" },
  { value: "it", label: "Italiano" },
];

/** How the agents write. The text is what they receive; the label is what people choose. */
export const TONES: { label: string; text: string }[] = [
  {
    label: "Profesional y cercano",
    text: "Profesional, cercano y breve. Personaliza con lo que diga el contacto.",
  },
  {
    label: "Formal",
    text: "Formal y respetuoso. Trata de usted, con frases completas y sin coloquialismos.",
  },
  {
    label: "Directo",
    text: "Cercano y directo. Mensajes cortos, una idea por mensaje y una pregunta clara al final.",
  },
  {
    label: "Cálido",
    text: "Cálido y empático. Interésate por la situación del contacto antes de proponer nada.",
  },
  { label: "Sencillo", text: "Cercano, sencillo y breve. Sin tecnicismos." },
  { label: "Técnico", text: "Técnico y preciso. Datos concretos, cifras y detalles del producto." },
];

export const DECISION_MAKERS = [
  "Gerencia o dirección general",
  "Dirección comercial",
  "Compras",
  "Dirección financiera",
  "Marketing",
  "Operaciones",
  "Recursos humanos",
  "Tecnología",
  "El propio cliente particular",
];

export const GEOGRAPHIES = [
  "Toda España",
  "Península",
  "Baleares",
  "Canarias",
  "Portugal",
  "Europa",
  "Latinoamérica",
];
