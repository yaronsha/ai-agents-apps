import { describe, expect, it } from "vitest";
import { allStops, PLACE_ALIAS, PLACE_FACTS, placeAlerts, placeNoticeAlerts, PLACES, publicTrip, thLocal } from "../src";

describe("place facts", () => {
  it("only describe places that have a place card", () => {
    expect(Object.keys(PLACE_FACTS).filter((id) => !PLACES[id])).toEqual([]);
  });

  it("write hours as HH:MM with the opening first", () => {
    const bad = Object.entries(PLACE_FACTS).filter(([, f]) => {
      const h = f.hours;
      if (!h) return false;
      const ok = (t?: string) => t === undefined || /^\d\d:\d\d$/.test(t);
      return !ok(h.open) || !ok(h.close) || !ok(h.lastEntry) || h.open >= h.close || (h.lastEntry !== undefined && h.lastEntry > h.close);
    });
    expect(bad.map(([id]) => id)).toEqual([]);
  });

  it("keep official links absolute", () => {
    const urls = Object.values(PLACE_FACTS).flatMap((f) => f.officialUrls ?? []);
    expect(urls.filter((u) => !/^https:\/\//.test(u))).toEqual([]);
  });
});

describe("placeAlerts", () => {
  const alerts = placeAlerts(publicTrip);
  const byId = (id: string) => alerts.find((a) => a.id === id);

  it("flags a stop on a weekday its place is partly closed", () => {
    // 30.11.2026 is a Monday; the mineral pool at Pha Soet closes on Mondays and Thursdays.
    expect(byId("place:pha-soet:closed")).toMatchObject({ date: "2026-11-30", category: "place", severity: "info", digest: true, pushAt: [] });
  });

  it("flags a visit planned before the place opens or past its closing", () => {
    expect(byId("place:cm-night-bazaar:early")?.titleHe).toContain("18:00");
    expect(byId("place:doi-suthep:closing")?.bodyHe).toContain("19:30");
  });

  it("leaves visits inside the opening hours alone", () => {
    expect(byId("place:white-temple:late")).toBeUndefined();
    expect(alerts.filter((a) => a.stopId === "mok-fa")).toEqual([]);
  });

  it("never colors a day: known facts are info only", () => {
    expect(alerts.every((a) => a.severity === "info")).toBe(true);
    const stops = new Set(allStops(publicTrip).map((s) => s.id));
    expect(alerts.every((a) => stops.has(a.stopId!) || stops.has(PLACE_ALIAS[a.stopId!]))).toBe(true);
  });
});

describe("placeNoticeAlerts", () => {
  const notice = { stopId: "mok-fa", date: "2026-11-25", severity: "urgent" as const, titleHe: "סגור", bodyHe: "סגור", url: "https://news.example/1" };

  it("pushes an urgent finding for today or tomorrow at once", () => {
    const now = thLocal("2026-11-24T14:00");
    expect(placeNoticeAlerts([notice], now)[0]).toMatchObject({ id: "site:mok-fa:https://news.example/1", severity: "urgent", pushAt: [now.toISOString()], digest: false });
  });

  it("keeps an urgent finding further ahead as a warning in the briefing", () => {
    expect(placeNoticeAlerts([notice], thLocal("2026-11-20T06:00"))[0]).toMatchObject({ severity: "warning", pushAt: [], digest: true });
  });
});
