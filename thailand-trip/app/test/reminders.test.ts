import { describe, expect, it } from "vitest";
import { publicTrip, type Reminder, type Stop } from "@trip/shared";
import { eveningReminders, remindersBefore } from "../src/screens/Today";

const stop = (id: string, start: string) => ({ id, start }) as Stop;
const rem = (id: string, at: string) => ({ id, at, textHe: id }) as Reminder;

describe("where reminders show without push", () => {
  it("shows every reminder in the trip exactly once: in a stop sheet or as an evening row", () => {
    for (const day of publicTrip.days) {
      const shown = [...day.stops.flatMap((s) => remindersBefore(day.stops, day.reminders, s)), ...eveningReminders(day.stops, day.reminders)];
      expect(shown.map((r) => r.id).sort(), day.date).toEqual(day.reminders.map((r) => r.id).sort());
    }
  });

  it("keeps the 21:00 boat-day and packing reminders as evening rows", () => {
    const ids = publicTrip.days.flatMap((d) => eveningReminders(d.stops, d.reminders).map((r) => r.id));
    expect(ids).toEqual(expect.arrayContaining(["r29-boat", "r02-checkout"]));
  });

  it("counts a reminder after the last stop's start as evening, even while the stop is still on", () => {
    const stops = [stop("a", "2026-11-29T09:30"), stop("b", "2026-11-29T19:30")];
    const day = [rem("before-b", "2026-11-29T19:00"), rem("at-b", "2026-11-29T19:30"), rem("late", "2026-11-29T21:00")];
    expect(eveningReminders(stops, day).map((r) => r.id)).toEqual(["late"]);
    expect(remindersBefore(stops, day, stops[1]).map((r) => r.id)).toEqual(["before-b", "at-b"]);
  });

  it("treats every reminder as evening on a day with no stops", () => {
    expect(eveningReminders([], [rem("x", "2026-11-30T21:00")]).map((r) => r.id)).toEqual(["x"]);
  });
});
