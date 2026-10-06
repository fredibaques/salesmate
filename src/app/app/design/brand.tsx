import { Logo } from "@/components/logo";
import { Card } from "@/components/ui";

/** The palette as Tailwind classes (spelled out so Tailwind generates them). */
const SCALES: { name: string; use: string; swatches: [string, string][] }[] = [
  {
    name: "Iris",
    use: "Marca: acción principal, enlaces, activo, foco.",
    swatches: [
      ["50", "bg-iris-50"],
      ["100", "bg-iris-100"],
      ["200", "bg-iris-200"],
      ["300", "bg-iris-300"],
      ["400", "bg-iris-400"],
      ["500", "bg-iris-500"],
      ["600", "bg-iris-600"],
      ["700", "bg-iris-700"],
      ["800", "bg-iris-800"],
      ["900", "bg-iris-900"],
      ["950", "bg-iris-950"],
    ],
  },
  {
    name: "Ink",
    use: "Neutros: texto, superficies y bordes.",
    swatches: [
      ["0", "bg-ink-0"],
      ["25", "bg-ink-25"],
      ["50", "bg-ink-50"],
      ["100", "bg-ink-100"],
      ["200", "bg-ink-200"],
      ["300", "bg-ink-300"],
      ["400", "bg-ink-400"],
      ["500", "bg-ink-500"],
      ["600", "bg-ink-600"],
      ["700", "bg-ink-700"],
      ["800", "bg-ink-800"],
      ["900", "bg-ink-900"],
      ["950", "bg-ink-950"],
    ],
  },
  {
    name: "Estados",
    use: "Leaf = bien · Amber = atención · Coral = error. El tono 700 es el del texto.",
    swatches: [
      ["leaf 50", "bg-leaf-50"],
      ["leaf 500", "bg-leaf-500"],
      ["leaf 700", "bg-leaf-700"],
      ["amber 50", "bg-amber-50"],
      ["amber 500", "bg-amber-500"],
      ["amber 700", "bg-amber-700"],
      ["coral 50", "bg-coral-50"],
      ["coral 600", "bg-coral-600"],
      ["coral 700", "bg-coral-700"],
    ],
  },
];

const TYPE: { label: string; className: string; spec: string }[] = [
  {
    label: "Título de página",
    className: "font-display text-2xl font-semibold tracking-tight",
    spec: "Jakarta 24/32 · 600",
  },
  {
    label: "Título de sección",
    className: "font-display text-xl font-semibold tracking-tight",
    spec: "Jakarta 20/28 · 600",
  },
  {
    label: "Título de tarjeta",
    className: "font-display text-base font-semibold",
    spec: "Jakarta 16/24 · 600",
  },
  { label: "Texto de la interfaz", className: "text-sm", spec: "Inter 14/20 · 400" },
  { label: "Etiquetas y botones", className: "text-sm font-medium", spec: "Inter 14/20 · 500" },
  { label: "Datos secundarios", className: "text-xs text-muted", spec: "Inter 12/16 · 400" },
  { label: "1.234,56 € · 09:30", className: "text-sm tabular-nums", spec: "Inter, cifras tabulares" },
  { label: "mcp.call_tool", className: "font-mono text-xs", spec: "JetBrains Mono 12/16" },
];

const SHADOWS: [string, string, string][] = [
  ["xs", "shadow-xs", "Controles y tarjetas en reposo"],
  ["sm", "shadow-sm", "Elementos sobre una tarjeta"],
  ["md", "shadow-md", "Tarjeta al pasar el ratón"],
  ["lg", "shadow-lg", "Menús, tooltips, avisos"],
  ["xl", "shadow-xl", "Ventanas modales"],
  ["brand", "shadow-brand bg-accent", "Botón principal"],
];

const RADII: [string, string, string][] = [
  ["md · 6", "rounded-md", "Etiquetas pequeñas"],
  ["lg · 8", "rounded-lg", "Botones y campos"],
  ["xl · 12", "rounded-xl", "Tarjetas y paneles"],
  ["2xl · 16", "rounded-2xl", "Modales y burbujas"],
  ["full", "rounded-full", "Insignias, avatares"],
];

const SPACING: [string, number, string][] = [
  ["1 · 4px", 4, "Icono y texto muy juntos"],
  ["2 · 8px", 8, "Dentro de un grupo (fichas, botones)"],
  ["3 · 12px", 12, "Icono de entidad y su texto"],
  ["4 · 16px", 16, "Entre tarjetas de una rejilla"],
  ["5 · 20px", 20, "Dentro de una tarjeta; entre campos"],
  ["6 · 24px", 24, "Entre secciones de una página"],
  ["8 · 32px", 32, "Márgenes de la página"],
];

/** The design line, at a glance. */
export function BrandSection() {
  return (
    <>
      <Card title="Marca">
        <div className="flex flex-wrap items-center gap-8">
          <Logo size={48} withName />
          <Logo size={32} />
          <div className="bg-ai h-12 w-48 rounded-xl shadow-brand" />
          <p className="max-w-sm text-sm text-muted">
            El degradado de la IA solo aparece en el logotipo y en el asistente. Todo lo demás usa colores
            planos.
          </p>
        </div>
      </Card>

      <Card title="Color">
        <div className="space-y-6">
          {SCALES.map((scale) => (
            <div key={scale.name}>
              <p className="text-sm font-medium">{scale.name}</p>
              <p className="text-xs text-muted">{scale.use}</p>
              <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-2">
                {scale.swatches.map(([label, bg]) => (
                  <div key={label}>
                    <div className={`h-12 rounded-lg border border-ink-200/60 ${bg}`} />
                    <p className="mt-1 text-xs text-muted tabular-nums">{label}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Tipografía">
        <div className="divide-y divide-border">
          {TYPE.map((t) => (
            <div
              key={t.label}
              className="flex flex-wrap items-baseline justify-between gap-2 py-3 first:pt-0 last:pb-0"
            >
              <span className={t.className}>{t.label}</span>
              <span className="text-xs text-muted">{t.spec}</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Sombras">
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
            {SHADOWS.map(([name, cls, use]) => (
              <div key={name}>
                <div className={`h-16 rounded-xl border border-border bg-surface ${cls}`} />
                <p className="mt-2 text-xs font-medium">{name}</p>
                <p className="text-xs text-muted">{use}</p>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Radios">
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
            {RADII.map(([name, cls, use]) => (
              <div key={name}>
                <div className={`h-16 border-2 border-iris-300 bg-iris-50 ${cls}`} />
                <p className="mt-2 text-xs font-medium">{name}</p>
                <p className="text-xs text-muted">{use}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Espaciado" tip="Todo se mide en múltiplos de 4 px.">
        <div className="space-y-2">
          {SPACING.map(([name, px, use]) => (
            <div key={name} className="grid grid-cols-[5rem_3rem_1fr] items-center gap-3 text-sm">
              <span className="text-xs text-muted tabular-nums">{name}</span>
              <span className="h-3 rounded-sm bg-iris-400" style={{ width: px }} />
              <span className="text-muted">{use}</span>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
