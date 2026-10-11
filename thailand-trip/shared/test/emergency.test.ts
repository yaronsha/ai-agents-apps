import { describe, expect, it } from "vitest";
import { dayOf, hospitals, hospitalsByDistance, publicTrip } from "../src";

describe("hospitalsByDistance", () => {
  it("puts Pai Hospital first when the phone is in Pai", () => {
    const list = hospitalsByDistance({ lat: 19.359, lng: 98.441 });
    expect(list[0].name).toBe("Pai Hospital");
    expect(list[0].km).toBeLessThan(1);
  });

  it("puts a Chiang Rai hospital first when the phone is in Chiang Rai", () => {
    expect(hospitalsByDistance({ lat: 19.91, lng: 99.84 })[0].area).toBe("צ'יאנג ראי");
  });

  it("sorts nearest first and keeps every hospital", () => {
    const list = hospitalsByDistance({ lat: 18.79, lng: 98.99 });
    const kms = list.map((h) => h.km);
    expect(kms).toEqual([...kms].sort((a, b) => a - b));
    expect(list).toHaveLength(hospitals.length);
  });

  it("falls back to the day's first stop the same way", () => {
    const day = publicTrip.days.find((d) => d.stops.length > 0)!;
    const first = dayOf(publicTrip, day.date)!.stops[0];
    const list = hospitalsByDistance(first);
    expect(list[0].km).toBe(Math.min(...list.map((h) => h.km)));
  });
});
