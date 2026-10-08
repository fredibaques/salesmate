import type { AgentSchedule } from "@/server/db/schema";

/** Describing an agent's schedule in words; shared by server and client. */

const MONTH_NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** "el 15 de octubre" for a "YYYY-MM-DD" date. */
export function dayInWords(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `el ${d} de ${MONTH_NAMES[m - 1]}`;
}

const DAY_LETTERS = ["", "L", "M", "X", "J", "V", "S", "D"];

/** How often a schedule works, in words ("cada día a las 08:00"). */
export function describeSchedule(schedule: AgentSchedule | null): string {
  if (!schedule) return "Cuando se lo pidas";
  switch (schedule.kind) {
    case "once":
      return `Una vez, ${dayInWords(schedule.at.slice(0, 10))} a las ${schedule.at.slice(11)}`;
    case "daily":
      return `Cada día a las ${schedule.time}`;
    case "monthly":
      return `Cada mes, el día ${schedule.day}, a las ${schedule.time}`;
    default: {
      const days = [...schedule.days].sort();
      if (days.length === 7) return `Cada día a las ${schedule.time}`;
      if (days.join() === "1,2,3,4,5") return `De lunes a viernes a las ${schedule.time}`;
      return `Cada semana (${days.map((d) => DAY_LETTERS[d]).join(" ")}) a las ${schedule.time}`;
    }
  }
}

export type RunMode = "manual" | "once" | "recurring";
export type Frequency = "daily" | "weekly" | "monthly";

/** How a schedule shows in the form. */
export function scheduleChoice(schedule: AgentSchedule | null): { mode: RunMode; frequency: Frequency } {
  if (!schedule) return { mode: "manual", frequency: "weekly" };
  if (schedule.kind === "once") return { mode: "once", frequency: "weekly" };
  return { mode: "recurring", frequency: schedule.kind ?? "weekly" };
}

/** The schedule a form describes (fields of `ScheduleFields`); null = only when asked. */
export function scheduleFromForm(form: FormData): AgentSchedule | null {
  const value = (key: string) => String(form.get(key) ?? "").trim();
  const mode = value("runMode") || "recurring";
  if (mode === "manual") return null;
  if (mode === "once") return { kind: "once", at: value("onceAt").slice(0, 16) };
  const time = value("time") || "08:00";
  switch (value("frequency")) {
    case "daily":
      return { kind: "daily", time };
    case "monthly":
      return { kind: "monthly", time, day: Number(value("monthDay")) || 1 };
    default:
      return { kind: "weekly", time, days: form.getAll("days").map(Number) };
  }
}
