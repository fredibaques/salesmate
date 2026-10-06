import { Download, Euro, Plus, Search, Settings, Trash2, User } from "lucide-react";
import { TabLink, Tabs, SubTabLink, SubTabs } from "@/components/nav-link";
import { PasswordInput } from "@/components/password-input";
import { CountBadge, SidebarDot } from "@/components/sidebar";
import { SwitchButton } from "@/components/switch";
import {
  Badge,
  Button,
  Card,
  Chip,
  Choice,
  Field,
  FormSection,
  InfoTip,
  Input,
  Notice,
  PageHeader,
  Segmented,
  Select,
  Textarea,
  Tooltip,
  type ButtonSize,
  type ButtonVariant,
  type ControlSize,
} from "@/components/ui";
import { BrandSection } from "./brand";
import { ChatDemo } from "./chat-demo";

export const metadata = { title: "Guía de estilo" };

const VARIANTS: { variant: ButtonVariant; label: string; use: string }[] = [
  { variant: "primary", label: "Primario", use: "La acción principal de la vista. Una por vista." },
  { variant: "secondary", label: "Secundario", use: "Otras acciones con peso." },
  {
    variant: "ghost",
    label: "Transparente",
    use: "Acciones discretas: cabeceras, filas, junto a un primario.",
  },
  { variant: "danger", label: "Peligro", use: "Confirmar algo que no se deshace." },
  { variant: "dangerGhost", label: "Peligro transparente", use: "Quitar o eliminar en reposo." },
];
const SIZES: { size: ButtonSize & ControlSize; label: string }[] = [
  { size: "sm", label: "Pequeño" },
  { size: "md", label: "Normal" },
  { size: "lg", label: "Grande" },
];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid items-start gap-4 md:grid-cols-[14rem_1fr]">
      <p className="pt-2 text-sm font-medium">{label}</p>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Reference of the shared components, to check them at a glance (not in the menu). */
export default function DesignPage() {
  return (
    <>
      <PageHeader
        title="Guía de estilo"
        tip="Los componentes comunes de la plataforma. Las reglas de uso están en docs/DESIGN.md."
      />
      <div className="space-y-6">
        <BrandSection />
        <Card title="Botones">
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
                      {variant.startsWith("danger") ? (
                        <Trash2 />
                      ) : variant === "primary" ? (
                        <Download />
                      ) : (
                        <Settings />
                      )}
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

        <Card
          title="Campos"
          tip="Field pone la etiqueta, la ayuda (tip con «?», hint debajo) y el error; dentro va el control."
        >
          <form className="space-y-6">
            <Row label="Tamaños">
              <div className="grid gap-3 sm:grid-cols-3">
                {SIZES.map(({ size, label }) => (
                  <Input key={size} size={size} placeholder={label} />
                ))}
              </div>
            </Row>
            <Row label="Con etiqueta y ayuda">
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Nombre" tip="Explica cómo funciona algo sin ocupar espacio.">
                  <Input placeholder="p. ej. Swipoo" icon={<User />} />
                </Field>
                <Field label="Web" optional hint="Una línea cuando el campo no es evidente.">
                  <Input type="url" placeholder="https://" />
                </Field>
                <Field label="Precio" error="Escribe un número mayor que 0.">
                  <Input invalid defaultValue="-3" suffix={<Euro className="size-4" />} />
                </Field>
                <Field label="Bloqueado">
                  <Input disabled defaultValue="No se puede cambiar" />
                </Field>
              </div>
            </Row>
            <Row label="Buscar, unidades y contraseña">
              <div className="grid gap-3 sm:grid-cols-3">
                <Input icon={<Search />} placeholder="Buscar…" />
                <Input type="number" defaultValue={30} suffix="min" />
                <PasswordInput defaultValue="secreto123" />
              </div>
            </Row>
            <Row label="Selector y texto largo">
              <div className="grid gap-3 sm:grid-cols-2">
                <Select defaultValue="b2b">
                  <option value="b2b">Empresas (B2B)</option>
                  <option value="b2c">Particulares (B2C)</option>
                </Select>
                <Textarea placeholder="Una por línea…" />
              </div>
            </Row>
          </form>
        </Card>

        <Card title="Opciones">
          <form className="space-y-6">
            <Row label="Casillas y radios">
              <div className="flex flex-wrap gap-6">
                <Choice label="Casilla" defaultChecked />
                <Choice label="Con descripción" description="Una línea que explica la opción." />
                <Choice type="radio" name="r" label="Radio A" defaultChecked />
                <Choice type="radio" name="r" label="Radio B" />
              </div>
            </Row>
            <Row label="Opciones en tarjeta">
              <div className="grid gap-2 sm:grid-cols-2">
                <Choice
                  card
                  type="radio"
                  name="c"
                  defaultChecked
                  label="Agendar reunión"
                  description="Ofrece huecos libres y reserva la reunión."
                />
                <Choice
                  card
                  type="radio"
                  name="c"
                  label="Enviar presupuesto"
                  description="Prepara un presupuesto con tus tarifas."
                />
              </div>
            </Row>
            <Row label="Fichas y segmentos">
              <div className="flex flex-wrap items-center gap-6">
                <div className="flex gap-1.5">
                  {["L", "M", "X", "J", "V", "S", "D"].map((d, i) => (
                    <Chip key={d} name="days" defaultChecked={i < 5}>
                      {d}
                    </Chip>
                  ))}
                </div>
                <Segmented
                  name="seg"
                  defaultValue="b2b"
                  options={[
                    { value: "b2b", label: "Empresas" },
                    { value: "b2c", label: "Particulares" },
                  ]}
                />
              </div>
            </Row>
            <FormSection
              title="Sección de formulario"
              tip="Agrupa campos relacionados dentro de un formulario largo."
            >
              <p className="text-sm text-muted">Contenido de la sección.</p>
            </FormSection>
          </form>
        </Card>

        <Card title="Ayuda y navegación">
          <div className="space-y-6">
            <Row label="Tooltips">
              <div className="flex flex-wrap items-center gap-4 pt-1">
                <span className="flex items-center gap-1 text-sm">
                  Título con ayuda <InfoTip>Cómo se usa esto, en una o dos frases.</InfoTip>
                </span>
                <Tooltip content="Cualquier elemento puede tener un tooltip.">
                  <Button variant="secondary" size="sm">
                    Pasa por encima
                  </Button>
                </Tooltip>
              </div>
            </Row>
            <Row label="Pestañas">
              <Tabs className="mb-0">
                <TabLink href="/app/design" exact>
                  Activa
                </TabLink>
                <TabLink href="/app/design/x" badge={<CountBadge count={3} />}>
                  Con contador
                </TabLink>
                <TabLink href="/app/design/y">Otra</TabLink>
              </Tabs>
            </Row>
            <Row label="Subpestañas">
              <SubTabs>
                <SubTabLink href="/app/design">Activa</SubTabLink>
                <SubTabLink href="/app/design/x">Otra</SubTabLink>
              </SubTabs>
            </Row>
            <Row label="Barra lateral">
              <div className="flex items-center gap-4 text-sm">
                <SidebarDot label="Swipoo" />
                <SidebarDot label="Pausado" muted />
                <CountBadge count={4} />
                <CountBadge count={120} tone="muted" />
              </div>
            </Row>
          </div>
        </Card>

        <Card title="Chat">
          <ChatDemo />
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
