import { describe, expect, it } from "vitest";
import { allStops, PICKS, placeFacts, publicTrip } from "../src";

const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

describe("Yaron's picks", () => {
  it("sit on a plan day, at a time on that day", () => {
    const days = new Set(publicTrip.days.map((d) => d.date));
    const bad = PICKS.filter((p) => !days.has(p.date) || !p.at.startsWith(p.date)).map((p) => p.id);
    expect(bad).toEqual([]);
  });

  it("point only at stops that are on the plan, on the same day", () => {
    const bad = PICKS.filter((p) => p.stopId && !publicTrip.days.find((d) => d.date === p.date)?.stops.some((s) => s.id === p.stopId)).map((p) => p.id);
    expect(bad).toEqual([]);
    expect(allStops(publicTrip).some((s) => s.id === "khao-soi")).toBe(true);
  });

  it("are suggested on a day and at an hour the place is open", () => {
    const bad = PICKS.filter((p) => {
      const f = (p.stopId && placeFacts(p.stopId)) || p.facts;
      const hm = p.at.slice(11);
      return f.closedOn?.includes(weekday(p.date)) || (f.hours && (hm < f.hours.open || hm >= f.hours.close));
    }).map((p) => p.id);
    expect(bad).toEqual([]);
  });

  it("never speak for Yaron outside his own quote", () => {
    const bad = PICKS.filter((p) => [p.teaserHe, p.tipHe, p.walkHe, p.warnHe].some((t) => t && /ירון/.test(t))).map((p) => p.id);
    expect(bad).toEqual([]);
  });

  it("keep the card line short enough for a phone", () => {
    expect(PICKS.filter((p) => p.teaserHe.length > 50).map((p) => p.id)).toEqual([]);
  });
});
