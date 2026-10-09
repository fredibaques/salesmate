"use client";

import { useState } from "react";
import type { AgentSchedule } from "@/server/db/schema";
import { scheduleChoice, type Frequency, type RunMode } from "@/lib/schedule";
import { Chip, Field, Input, Segmented, Select } from "./ui";

const MODES: { value: RunMode; label: string }[] = [
  { value: "manual", label: "Cuando se lo pida" },
  { value: "once", label: "Una vez" },
  { value: "recurring", label: "Se repite" },
];

const FREQUENCIES: { value: Frequency; label: string }[] = [
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
 * When an agent works: only when someone asks («Ejecutar ahora»), once at a
 * given moment, or again and again (every day, some weekdays, or a day of
 * the month). Times are the project's. Read with `scheduleFromForm`.
 */
export function ScheduleFields({
  schedule,
  label = "Cuándo trabaja",
  manualLabel = "Cuando se lo pida",
}: {
  schedule: AgentSchedule | null;
  label?: string;
  /** Name of the option without a schedule. */
  manualLabel?: string;
}) {
  const initial = scheduleChoice(schedule);
  const [mode, setMode] = useState<RunMode>(initial.mode);
  const [frequency, setFrequency] = useState<Frequency>(initial.frequency);
  const time = schedule && schedule.kind !== "once" ? schedule.time : "08:00";
  const days =
    schedule && (schedule.kind === undefined || schedule.kind === "weekly") ? schedule.days : [1, 2, 3, 4, 5];
  const monthDay = schedule?.kind === "monthly" ? schedule.day : 1;

  return (
    <>
      <Field
        label={label}
        group
        tip="Siempre en la hora del proyecto y solo mientras el agente esté activo. Sea cual sea la opción, puedes lanzarlo cuando quieras con «Ejecutar ahora»."
      >
        <Segmented
          name="runMode"
          options={MODES.map((m) => (m.value === "manual" ? { ...m, label: manualLabel } : m))}
          defaultValue={initial.mode}
          onChange={(v) => setMode(v as RunMode)}
        />
      </Field>
      {mode === "once" ? (
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
      {mode === "recurring" ? (
        <>
          <Field label="Frecuencia" group>
            <Segmented
              name="frequency"
              options={FREQUENCIES}
              defaultValue={initial.frequency}
              onChange={(v) => setFrequency(v as Frequency)}
            />
          </Field>
          <div className="flex flex-wrap gap-4">
            {frequency === "weekly" ? (
              <Field label="Días" group>
                <div className="flex flex-wrap gap-1.5">
                  {DAYS.map(([n, label]) => (
                    <Chip key={n} name="days" value={n} defaultChecked={days.includes(n)}>
                      {label}
                    </Chip>
                  ))}
                </div>
              </Field>
            ) : null}
            {frequency === "monthly" ? (
              <Field label="Día del mes" tip="Si un mes no tiene ese día (31 en abril), trabaja el último.">
                <Select name="monthDay" defaultValue={String(monthDay)} className="w-32">
                  {Array.from({ length: 31 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      Día {i + 1}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Field
              label="Hora"
              tip="Trabaja a partir de esa hora: el programador pasa cada 15 minutos de día y cada hora de noche."
            >
              <Input name="time" type="time" defaultValue={time} required className="w-32" />
            </Field>
          </div>
        </>
      ) : null}
    </>
  );
}
