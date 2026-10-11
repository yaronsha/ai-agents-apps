import { describe, expect, it } from "vitest";
import { allStops, PLACE_ALIAS, PLACES, placeInfo, publicTrip } from "../src";

describe("place cards", () => {
  it("describe every stop on the plan", () => {
    const missing = allStops(publicTrip).filter((s) => !placeInfo(s.id)).map((s) => s.id);
    expect(missing).toEqual([]);
  });

  it("have no entries for stops that are no longer on the plan", () => {
    const ids = new Set(allStops(publicTrip).map((s) => PLACE_ALIAS[s.id] ?? s.id));
    expect(Object.keys(PLACES).filter((id) => !ids.has(id))).toEqual([]);
  });

  it("keep the timeline line short enough for one line on a phone", () => {
    const long = Object.entries(PLACES).filter(([, p]) => p.teaserHe.length > 50).map(([id]) => id);
    expect(long).toEqual([]);
  });
});
