"use client";

import { useState } from "react";
import type { AgentSchedule } from "@/server/db/schema";
import { repeatOf, type Repeat } from "@/lib/schedule";
import { Chip, Field, Input, Segmented, Select } from "./ui";

const REPEATS: { value: Repeat; label: string }[] = [
  { value: "never", label: "Sin horario" },
  { value: "once", label: "Una vez" },
  { value: "daily", label: "Cada día" },
  { value: "weekly", label: "Cada semana" },
  { value: "monthly", label: "Cada mes" },
];

const DAYS = [
  [1, "L"],
  [2, "M"],
  [3, "X"],
  [4, "J"],
  [5, "V"],
  [6, "S"],
  [7, "D"],
] as const;

/** Tomorrow at 09:00, local to the browser, as a datetime-local value. */
function tomorrowMorning(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T09:00`;
}

/**
 * When an agent works by itself, on top of «Ejecutar ahora» (always there):
 * never, once, or every N days, weeks (on some weekdays) or months (on a
 * day), at a time. Times are the project's. Read with `scheduleFromForm`.
 */
export function ScheduleFields({
  schedule,
  label = "Por su cuenta",
}: {
  schedule: AgentSchedule | null;
  label?: string;
}) {
  const [repeat, setRepeat] = useState<Repeat>(repeatOf(schedule));
  const recurring = schedule && schedule.kind !== "once" ? schedule : null;
  const time = recurring?.time ?? "08:00";
  const every = recurring?.every ?? 1;
  const days =
    recurring && (recurring.kind === undefined || recurring.kind === "weekly")
      ? recurring.days
      : [1, 2, 3, 4, 5];
  const monthDay = recurring?.kind === "monthly" ? recurring.day : 1;
  // Changing how often it repeats counts «every N» from today again.
  const from = recurring && repeat === repeatOf(schedule) ? recurring.from : undefined;
  const everyField = (unit: string, units: string) => (
    <Field label="Cada cuánto" tip={`1: cada ${unit}. 2: uno sí y otro no. 3: uno de cada tres…`}>
      <Input
        name="every"
        type="number"
        min={1}
        max={52}
        defaultValue={every}
        suffix={units}
        className="w-36"
      />
    </Field>
  );

  return (
    <>
      <Field
        label={label}
        group
        tip="Además de cuando se lo pides con «Ejecutar ahora», que siempre puedes. En la hora del proyecto y solo mientras el agente esté activo."
      >
        <Segmented
          name="repeat"
          options={REPEATS}
          defaultValue={repeatOf(schedule)}
          onChange={(v) => setRepeat(v as Repeat)}
        />
      </Field>
      {repeat === "once" ? (
        <Field label="Día y hora">
          <Input
            name="onceAt"
            type="datetime-local"
            required
            defaultValue={schedule?.kind === "once" ? schedule.at : tomorrowMorning()}
            className="w-56"
          />
        </Field>
      ) : null}
      {repeat === "daily" || repeat === "weekly" || repeat === "monthly" ? (
        <div className="flex flex-wrap gap-4">
          {from ? <input type="hidden" name="from" value={from} /> : null}
          {repeat === "weekly" ? (
            <Field label="Qué días" group>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map(([n, label]) => (
                  <Chip key={n} name="days" value={n} defaultChecked={days.includes(n)}>
                    {label}
                  </Chip>
                ))}
              </div>
            </Field>
          ) : null}
          {repeat === "monthly" ? (
            <Field label="Qué día del mes" tip="Si un mes no tiene ese día (31 en abril), trabaja el último.">
              <Select name="monthDay" defaultValue={String(monthDay)} className="w-32">
                {Array.from({ length: 31 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    Día {i + 1}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {repeat === "daily" ? everyField("día", "días") : null}
          {repeat === "weekly" ? everyField("semana", "semanas") : null}
          {repeat === "monthly" ? everyField("mes", "meses") : null}
          <Field
            label="Hora"
            tip="Trabaja a partir de esa hora: el programador pasa cada 15 minutos de día y cada hora de noche."
          >
            <Input name="time" type="time" defaultValue={time} required className="w-32" />
          </Field>
        </div>
      ) : null}
    </>
  );
}
