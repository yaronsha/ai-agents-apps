import { describe, expect, it } from "vitest";
import { dayOrDefault, publicTrip } from "@trip/shared";
import { parseTripState, toTripState } from "../src/tripState";
import { readPushPayload } from "../src/pushPayload";

describe("parseTripState", () => {
  it("fills fields an older version did not save", () => {
    const s = parseTripState(JSON.stringify({ generatedAt: "2026-11-22T08:00:00Z", alerts: [] }));
    expect(s).toEqual({ generatedAt: "2026-11-22T08:00:00Z", alerts: [], dayStatus: {}, forecasts: {}, sources: {} });
  });

  it("gives null for corrupt or foreign values instead of throwing", () => {
    expect(parseTripState("{not json")).toBeNull();
    expect(parseTripState("null")).toBeNull();
    expect(parseTripState(JSON.stringify({ hello: 1 }))).toBeNull();
    expect(parseTripState(null)).toBeNull();
  });

  it("drops alerts that are not alerts", () => {
    const alert = { id: "a", category: "weather", severity: "info", date: "2026-11-22", titleHe: "", bodyHe: "", pushAt: [], digest: false };
    const s = toTripState({ generatedAt: "x", alerts: [alert, null, "x", { id: "b" }], sources: [] });
    expect(s?.alerts).toEqual([alert]);
    expect(s?.sources).toEqual({});
  });
});

describe("readPushPayload", () => {
  const msg = (body: string) => ({ json: () => JSON.parse(body), text: () => body });

  it("reads a JSON push", () => {
    expect(readPushPayload(msg('{"title":"t","body":"b"}'))).toEqual({ title: "t", body: "b" });
  });

  it("shows plain text as the body instead of throwing", () => {
    expect(readPushPayload(msg("hello"))).toEqual({ body: "hello" });
  });

  it("handles a push with no data", () => {
    expect(readPushPayload(null)).toEqual({});
    expect(readPushPayload(msg('"just a string"'))).toEqual({ body: '"just a string"' });
  });
});

describe("dayOrDefault", () => {
  it("returns the matching day", () => {
    const d = publicTrip.days[2];
    expect(dayOrDefault(publicTrip, d.date)).toBe(d);
  });

  it("falls back to a trip day for a date outside the trip", () => {
    expect(publicTrip.days).toContain(dayOrDefault(publicTrip, "1999-01-01"));
  });
});
