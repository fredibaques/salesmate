import { TZDate } from "@date-fns/tz";
import type { WeeklyHours } from "../db/schema";

export type Interval = { start: Date; end: Date };

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export type SlotRules = {
  weeklyHours: WeeklyHours;
  timezone: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minNoticeMinutes: number;
  horizonDays: number;
  stepMinutes: number;
};

/** Merges overlapping/adjacent intervals. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: Interval[] = [];
  for (const i of sorted) {
    const last = merged.at(-1);
    if (last && i.start.getTime() <= last.end.getTime()) {
      if (i.end.getTime() > last.end.getTime()) last.end = i.end;
    } else {
      merged.push({ start: i.start, end: i.end });
    }
  }
  return merged;
}

function overlaps(a: Interval, b: Interval) {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

function hm(value: string): [number, number] {
  const [h, m] = value.split(":").map(Number);
  return [h, m ?? 0];
}

/**
 * Free slots for a meeting type given the host's busy intervals across ALL
 * their calendars (one person, many projects). Weekly hours are wall-clock
 * times in `timezone`, so DST changes are handled per day.
 */
export function computeSlots(rules: SlotRules, busy: Interval[], now: Date): Interval[] {
  const blocked = mergeIntervals(busy);
  const earliest = now.getTime() + rules.minNoticeMinutes * 60_000;
  const slots: Interval[] = [];
  const today = new TZDate(now.getTime(), rules.timezone);

  for (let day = 0; day <= rules.horizonDays; day++) {
    const date = new TZDate(today.getFullYear(), today.getMonth(), today.getDate() + day, rules.timezone);
    const ranges = rules.weeklyHours[WEEKDAYS[date.getDay()]] ?? [];
    for (const [from, to] of ranges) {
      const [fh, fm] = hm(from);
      const [th, tm] = hm(to);
      const rangeStart = new TZDate(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        fh,
        fm,
        0,
        rules.timezone,
      ).getTime();
      const rangeEnd = new TZDate(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        th,
        tm,
        0,
        rules.timezone,
      ).getTime();

      for (
        let start = rangeStart;
        start + rules.durationMinutes * 60_000 <= rangeEnd;
        start += rules.stepMinutes * 60_000
      ) {
        if (start < earliest) continue;
        const slot = { start: new Date(start), end: new Date(start + rules.durationMinutes * 60_000) };
        const padded = {
          start: new Date(slot.start.getTime() - rules.bufferBeforeMinutes * 60_000),
          end: new Date(slot.end.getTime() + rules.bufferAfterMinutes * 60_000),
        };
        if (!blocked.some((b) => overlaps(b, padded))) slots.push(slot);
      }
    }
  }
  return slots;
}
