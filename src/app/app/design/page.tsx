import { Download, Plus, Settings, Trash2 } from "lucide-react";
import { SwitchButton } from "@/components/switch";
import { Badge, Button, Card, Notice, PageHeader, type ButtonSize, type ButtonVariant } from "@/components/ui";

export const metadata = { title: "Guía de estilo" };

const VARIANTS: { variant: ButtonVariant; label: string; use: string }[] = [
  { variant: "primary", label: "Primario", use: "La acción principal de la vista. Una por vista." },
  { variant: "secondary", label: "Secundario", use: "Otras acciones con peso." },
  { variant: "ghost", label: "Transparente", use: "Acciones discretas: cabeceras, filas, junto a un primario." },
  { variant: "danger", label: "Peligro", use: "Confirmar algo que no se deshace." },
  { variant: "dangerGhost", label: "Peligro transparente", use: "Quitar o eliminar en reposo." },
];
const SIZES: { size: ButtonSize; label: string }[] = [
  { size: "sm", label: "Pequeño" },
  { size: "md", label: "Normal" },
  { size: "lg", label: "Grande" },
];

/** Reference of the shared components, to check them at a glance (not in the menu). */
export default function DesignPage() {
  return (
    <>
      <PageHeader
        title="Guía de estilo"
        description="Los componentes comunes de la plataforma. Las reglas de uso están en docs/DESIGN.md."
      />
      <div className="space-y-6">
        <Card title="Botones" description="Un solo estilo para todo lo que es una acción: variante × tamaño, con o sin icono.">
          <div className="space-y-6">
            {VARIANTS.map(({ variant, label, use }) => (
              <div key={variant} className="grid items-center gap-4 md:grid-cols-[14rem_1fr]">
                <div>
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-muted">{use}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {SIZES.map(({ size, label: sizeLabel }) => (
                    <Button key={size} variant={variant} size={size}>
                      {sizeLabel}
                    </Button>
                  ))}
                  <Button variant={variant}>
                    {variant.startsWith("danger") ? <Trash2 /> : <Plus />}
                    Con icono
                  </Button>
                  {SIZES.map(({ size }) => (
                    <Button key={size} variant={variant} size={size} iconOnly aria-label="Solo icono">
                      {variant.startsWith("danger") ? <Trash2 /> : variant === "primary" ? <Download /> : <Settings />}
                    </Button>
                  ))}
                  <Button variant={variant} disabled>
                    Desactivado
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Estados">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="success">Activo</Badge>
            <Badge tone="warning">En pausa</Badge>
            <Badge tone="danger">Con errores</Badge>
            <Badge tone="accent">Por aprobar</Badge>
            <Badge>Próximamente</Badge>
            <form>
              <SwitchButton on label="Interruptor activo" />
            </form>
            <form>
              <SwitchButton on={false} offLabel="En pausa" label="Interruptor en pausa" />
            </form>
          </div>
          <div className="mt-4 space-y-2">
            <Notice>Información útil sobre la página.</Notice>
            <Notice tone="success">Algo ha ido bien.</Notice>
            <Notice tone="warning">Algo necesita tu atención.</Notice>
            <Notice tone="danger">Algo ha fallado.</Notice>
          </div>
        </Card>
      </div>
    </>
  );
}
