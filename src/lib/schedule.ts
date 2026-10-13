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

/** «cada 2 semanas» / «cada semana». */
function everyWords(every: number | undefined, one: string, many: string): string {
  return every && every > 1 ? `cada ${every} ${many}` : `cada ${one}`;
}

/** How often a schedule works, in words ("cada día a las 08:00"). */
export function describeSchedule(schedule: AgentSchedule | null): string {
  if (!schedule) return "Cuando se lo pidas";
  switch (schedule.kind) {
    case "once":
      return `Una vez, ${dayInWords(schedule.at.slice(0, 10))} a las ${schedule.at.slice(11)}`;
    case "daily":
      return `${capital(everyWords(schedule.every, "día", "días"))} a las ${schedule.time}`;
    case "monthly":
      return `${capital(everyWords(schedule.every, "mes", "meses"))}, el día ${schedule.day}, a las ${schedule.time}`;
    default: {
      const days = [...schedule.days].sort();
      const weekly = !schedule.every || schedule.every <= 1;
      if (weekly && days.length === 7) return `Cada día a las ${schedule.time}`;
      if (weekly && days.join() === "1,2,3,4,5") return `De lunes a viernes a las ${schedule.time}`;
      return `${capital(everyWords(schedule.every, "semana", "semanas"))} (${days.map((d) => DAY_LETTERS[d]).join(" ")}) a las ${schedule.time}`;
    }
  }
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** How often it works by itself: never (only when asked), once, or every N days, weeks or months. */
export type Repeat = "never" | "once" | "daily" | "weekly" | "monthly";

/** How a schedule shows in the form. */
export function repeatOf(schedule: AgentSchedule | null): Repeat {
  if (!schedule) return "never";
  return schedule.kind ?? "weekly";
}

/** Today as "YYYY-MM-DD" (where the form is read). */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The schedule a form describes (fields of `ScheduleFields`); null = only when asked. */
export function scheduleFromForm(form: FormData): AgentSchedule | null {
  const value = (key: string) => String(form.get(key) ?? "").trim();
  const repeat = value("repeat") as Repeat;
  if (!repeat || repeat === "never") return null;
  if (repeat === "once") return { kind: "once", at: value("onceAt").slice(0, 16) };
  const time = value("time") || "08:00";
  const every = Math.max(1, Math.round(Number(value("every")) || 1));
  // «Every N» counts from the day it was set (kept while it doesn't change).
  const step = every > 1 ? { every, from: value("from") || today() } : {};
  switch (repeat) {
    case "daily":
      return { kind: "daily", time, ...step };
    case "monthly":
      return { kind: "monthly", time, day: Number(value("monthDay")) || 1, ...step };
    default:
      return { kind: "weekly", time, days: form.getAll("days").map(Number), ...step };
  }
}
