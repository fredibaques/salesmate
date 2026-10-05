import { CalendarPlus, Clock, Plus, Trash2 } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { ModalButton } from "@/components/modal";
import { Badge, Button, Card, Chip, EmptyState, Field, Input, Select } from "@/components/ui";
import type { listMeetingTypes } from "@/server/services/projects";
import { addMeetingType, previewAvailability, removeMeetingType } from "./actions";

const KINDS = {
  demo: "Demo",
  discovery: "Reunión de descubrimiento",
  closing_call: "Llamada de cierre",
  callback: "Franja de llamada (callback)",
  custom: "Otra",
} as const;
const DAY_LABELS: Record<string, string> = {
  mon: "L",
  tue: "M",
  wed: "X",
  thu: "J",
  fri: "V",
  sat: "S",
  sun: "D",
};
const DAYS = [
  ["mon", "L"],
  ["tue", "M"],
  ["wed", "X"],
  ["thu", "J"],
  ["fri", "V"],
  ["sat", "S"],
  ["sun", "D"],
] as const;

function NewMeetingTypeButton({
  projectId,
  calendars,
}: {
  projectId: string;
  calendars: { id: string; address: string }[];
}) {
  return (
    <ModalButton
      label="Nuevo tipo de reunión"
      icon={<Plus className="size-4" />}
      title="Nuevo tipo de reunión"
      width="lg"
    >
      <ActionForm action={addMeetingType.bind(null, projectId)} submitLabel="Crear" className="space-y-4">
        <Field label="Nombre">
          <Input name="name" required placeholder="Demo de 30 minutos" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo">
            <Select name="kind" defaultValue="demo">
              {Object.entries(KINDS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Duración (min)">
            <Input name="duration" type="number" defaultValue={30} min={5} />
          </Field>
        </div>
        <Field label="Días" group>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map(([k, l]) => (
              <Chip key={k} name="days" value={k} defaultChecked={!["sat", "sun"].includes(k)}>
                {l}
              </Chip>
            ))}
          </div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Desde">
            <Input name="from" type="time" defaultValue="09:00" />
          </Field>
          <Field label="Hasta">
            <Input name="to" type="time" defaultValue="14:00" />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Margen después (min)">
            <Input name="bufferAfter" type="number" defaultValue={10} min={0} />
          </Field>
          <Field label="Antelación mínima (h)">
            <Input name="minNoticeHours" type="number" defaultValue={4} min={0} />
          </Field>
          <Field label="Horizonte (días)">
            <Input name="horizonDays" type="number" defaultValue={14} min={1} />
          </Field>
        </div>
        <Field
          label="Calendario donde se crean las reuniones"
          tip="Si lo dejas vacío, se usa el calendario elegido en los canales del agente."
        >
          <Select name="calendarIdentityId" defaultValue={calendars[0]?.id ?? ""}>
            <option value="">— Elegir más tarde —</option>
            {calendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.address}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Lugar o enlace de videollamada">
          <Input name="location" placeholder="https://meet.google.com/…" />
        </Field>
      </ActionForm>
    </ModalButton>
  );
}

/** Meeting types of a project: what agents offer when the next step is a meeting or a call. */
export function MeetingTypesCard({
  projectId,
  timezone,
  types,
  calendars,
}: {
  projectId: string;
  timezone: string;
  types: Awaited<ReturnType<typeof listMeetingTypes>>;
  calendars: { id: string; address: string }[];
}) {
  return (
    <Card
      title="Reuniones que puede agendar"
      tip="Duración y horario de las reuniones o llamadas que ofrece. Los huecos se calculan con la disponibilidad de todos tus calendarios, de todos tus proyectos."
      actions={types.length > 0 ? <NewMeetingTypeButton projectId={projectId} calendars={calendars} /> : null}
    >
      {types.length === 0 ? (
        <EmptyState
          compact
          icon={<CalendarPlus />}
          title="Sin tipos de reunión"
          description="Crea al menos uno para que el agente pueda ofrecer huecos reales de tu calendario."
          action={<NewMeetingTypeButton projectId={projectId} calendars={calendars} />}
        />
      ) : (
        <ul className="space-y-3">
          {types.map((t) => (
            <li key={t.id} className="rounded-xl border border-border p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{t.name}</span>
                <span className="flex items-center gap-2">
                  <Badge>{KINDS[t.kind]}</Badge>
                  <form action={removeMeetingType.bind(null, projectId, t.id)}>
                    <Button variant="dangerGhost" size="sm" iconOnly aria-label={`Eliminar ${t.name}`}>
                      <Trash2 className="size-4" />
                    </Button>
                  </form>
                </span>
              </div>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                <Clock className="size-3.5" />
                {t.durationMinutes} min ·{" "}
                {Object.entries(t.weeklyHours)
                  .map(([d, ranges]) => `${DAY_LABELS[d] ?? d} ${ranges?.map((r) => r.join("–")).join(", ")}`)
                  .join(" · ")}
              </p>
              <div className="mt-3">
                <ActionForm
                  action={previewAvailability.bind(null, t.id, t.timezone ?? timezone)}
                  submitLabel="Ver próximos huecos"
                  submitVariant="secondary"
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
