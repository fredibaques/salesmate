import { describe, expect, it } from "vitest";
import { computeSlots, mergeIntervals, type SlotRules } from "./slots";

const rules: SlotRules = {
  weeklyHours: { wed: [["09:00", "11:00"]] },
  timezone: "Europe/Madrid",
  durationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  minNoticeMinutes: 0,
  horizonDays: 0,
  stepMinutes: 30,
};
// Wednesday 7 Oct 2026, 06:00 Madrid
const now = new Date("2026-10-07T04:00:00Z");
const iso = (slots: { start: Date }[]) => slots.map((s) => s.start.toISOString());

describe("computeSlots", () => {
  it("generates slots in the local working hours", () => {
    expect(iso(computeSlots(rules, [], now))).toEqual([
      "2026-10-07T07:00:00.000Z",
      "2026-10-07T07:30:00.000Z",
      "2026-10-07T08:00:00.000Z",
      "2026-10-07T08:30:00.000Z",
    ]);
  });

  it("removes slots that collide with busy time including buffers", () => {
    const busy = [{ start: new Date("2026-10-07T08:00:00Z"), end: new Date("2026-10-07T08:30:00Z") }];
    expect(iso(computeSlots({ ...rules, bufferAfterMinutes: 10 }, busy, now))).toEqual([
      "2026-10-07T07:00:00.000Z",
      "2026-10-07T08:30:00.000Z",
    ]);
  });

  it("respects the minimum notice", () => {
    // now + 200 min = 07:20Z, so the 07:00Z slot is too soon.
    expect(iso(computeSlots({ ...rules, minNoticeMinutes: 200 }, [], now))).toEqual([
      "2026-10-07T07:30:00.000Z",
      "2026-10-07T08:00:00.000Z",
      "2026-10-07T08:30:00.000Z",
    ]);
  });

  it("follows wall-clock time across DST changes", () => {
    // Sunday 25 Oct 2026 Spain switches from UTC+2 to UTC+1.
    const monday = {
      ...rules,
      weeklyHours: { mon: [["09:00", "09:30"]] as [string, string][] },
      horizonDays: 7,
    };
    const slots = computeSlots(monday, [], new Date("2026-10-20T00:00:00Z"));
    expect(iso(slots)).toEqual(["2026-10-26T08:00:00.000Z"]);
  });
});

describe("mergeIntervals", () => {
  it("merges overlapping and adjacent intervals", () => {
    const d = (h: number) => new Date(Date.UTC(2026, 9, 7, h));
    expect(
      mergeIntervals([
        { start: d(9), end: d(10) },
        { start: d(10), end: d(11) },
        { start: d(13), end: d(14) },
      ]),
    ).toEqual([
      { start: d(9), end: d(11) },
      { start: d(13), end: d(14) },
    ]);
  });
});
