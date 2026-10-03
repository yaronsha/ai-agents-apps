import { describe, expect, it } from "vitest";
import {
  cloudSeaChance,
  dayOf,
  dayStatuses,
  deferPastQuiet,
  duePushes,
  eveningDigest,
  flightAlerts,
  quakeAlerts,
  reminderAlerts,
  routeAlert,
  summarizeStop,
  thLocal,
  trip,
  warningPushes,
  weatherAlerts,
  type HourlyForecast,
  type TripAlert,
} from "../src";

function hourly(date: string, fill: Partial<Record<keyof Omit<HourlyForecast, "time">, number>>): HourlyForecast {
  const time = Array.from({ length: 24 }, (_, h) => `${date}T${String(h).padStart(2, "0")}:00`);
  const col = (v: number | undefined) => time.map(() => v ?? 0);
  return {
    time,
    precipProb: col(fill.precipProb),
    precip: col(fill.precip),
    code: col(fill.code),
    temp: col(fill.temp ?? 20),
    lowCloud: col(fill.lowCloud),
    highCloud: col(fill.highCloud),
  };
}

describe("time", () => {
  it("moves a 23:00 push to 06:00 the next morning", () => {
    expect(deferPastQuiet(thLocal("2026-11-24T23:00")).toISOString()).toBe(thLocal("2026-11-25T06:00").toISOString());
  });
  it("moves a 04:00 push to 06:00 the same morning", () => {
    expect(deferPastQuiet(thLocal("2026-11-25T04:00")).toISOString()).toBe(thLocal("2026-11-25T06:00").toISOString());
  });
  it("leaves daytime alone", () => {
    expect(deferPastQuiet(thLocal("2026-11-25T14:00")).toISOString()).toBe(thLocal("2026-11-25T14:00").toISOString());
  });
});

describe("weather", () => {
  const day = dayOf(trip, "2026-11-26")!;
  const canyon = day.stops.find((s) => s.id === "pai-canyon")!;

  it("warns about heavy rain at an outdoor stop, the evening before and 2 hours before", () => {
    const fc = hourly("2026-11-26", { precipProb: 80, precip: 3 });
    const summary = summarizeStop(canyon, fc);
    const alerts = weatherAlerts(day, { [canyon.id]: summary });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("warning");
    expect(alerts[0].pushAt).toEqual([
      thLocal("2026-11-25T20:00").toISOString(),
      thLocal("2026-11-26T14:30").toISOString(),
    ]);
  });

  it("stays quiet for light drizzle", () => {
    const fc = hourly("2026-11-26", { precipProb: 80, precip: 0.5 });
    expect(weatherAlerts(day, { [canyon.id]: summarizeStop(canyon, fc) })).toHaveLength(0);
  });

  it("always warns about thunderstorms", () => {
    const fc = hourly("2026-11-26", { code: 95 });
    expect(weatherAlerts(day, { [canyon.id]: summarizeStop(canyon, fc) })[0].id).toContain("storm");
  });

  it("pushes 2 hours before an early stop at 06:00, not in the night", () => {
    expect(warningPushes("2026-11-30", thLocal("2026-11-30T06:00"))).toEqual([
      thLocal("2026-11-29T20:00").toISOString(),
      thLocal("2026-11-30T06:00").toISOString(),
    ]);
  });
});

describe("sea of clouds", () => {
  const stop = dayOf(trip, "2026-11-30")!.stops.find((s) => s.id === "phu-chi-fa")!;
  it("is likely with low cloud under a clear sky", () => {
    expect(cloudSeaChance(stop, hourly("2026-11-30", { lowCloud: 80, highCloud: 10 }))).toBe("high");
  });
  it("is unlikely with no low cloud", () => {
    expect(cloudSeaChance(stop, hourly("2026-11-30", { lowCloud: 5, highCloud: 10 }))).toBe("low");
  });
});

describe("quakes", () => {
  const now = thLocal("2026-11-26T12:00");
  const base = { id: "us1", lat: 19.6, lng: 98.0, timeMs: now.getTime() - 600_000, place: "Myanmar", url: "https://example.com" };
  it("pushes at once for a strong quake near today's stops", () => {
    const alerts = quakeAlerts(trip, [{ ...base, mag: 5.6 }], now);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("urgent");
  });
  it("ignores small or distant quakes", () => {
    expect(quakeAlerts(trip, [{ ...base, mag: 4.6 }], now)).toHaveLength(0);
    expect(quakeAlerts(trip, [{ ...base, mag: 6, lat: 5, lng: 95 }], now)).toHaveLength(0);
  });
});

describe("roads and flights", () => {
  const now = thLocal("2026-11-25T07:00");
  const drive = dayOf(trip, "2026-11-25")!.drives[0];
  it("tells you to leave earlier when traffic is 30% slower", () => {
    const a = routeAlert(trip, drive, "2026-11-25", { durationSec: 4 * 3600 * 1.5, staticSec: 4 * 3600 }, now)!;
    expect(a.titleHe).toContain("120");
  });
  it("is silent in normal traffic", () => {
    expect(routeAlert(trip, drive, "2026-11-25", { durationSec: 3700, staticSec: 3600 }, now)).toBeNull();
  });
  it("flags a cancelled flight and a gate change", () => {
    const flight = { id: "out-2", number: "EY000", fromIata: "AUH", toIata: "CNX", departLocal: "2026-11-21T21:15", departUtcOffset: 4, labelHe: "x" };
    expect(flightAlerts(flight, { status: "Canceled", delayMin: 0 }, undefined, now)[0].id).toContain("cancel");
    expect(flightAlerts(flight, { status: "Expected", delayMin: 0, gate: "B2" }, "A1", now)[0].id).toContain("gate");
  });
});

describe("push scheduling", () => {
  const alert: TripAlert = {
    id: "x", category: "weather", severity: "warning", date: "2026-11-26", titleHe: "", bodyHe: "",
    pushAt: [thLocal("2026-11-25T20:00").toISOString(), thLocal("2026-11-26T14:30").toISOString()], digest: true,
  };
  it("sends each push once", () => {
    const now = thLocal("2026-11-25T20:05");
    expect(duePushes([alert], now, new Set()).map((p) => p.key)).toEqual(["x#0"]);
    expect(duePushes([alert], now, new Set(["x#0"]))).toHaveLength(0);
  });
  it("drops a push that is more than 2 hours late", () => {
    expect(duePushes([alert], thLocal("2026-11-26T09:00"), new Set())).toHaveLength(0);
  });
  it("turns reminders into pushes at their time", () => {
    const r = reminderAlerts(trip).find((a) => a.id === "reminder:r24-pickup")!;
    expect(r.pushAt[0]).toBe(thLocal("2026-11-24T14:45").toISOString());
  });
  it("colours a day red for urgent alerts and ignores reminders", () => {
    const s = dayStatuses(trip, [...reminderAlerts(trip), { ...alert, severity: "urgent" }]);
    expect(s["2026-11-26"]).toBe("red");
    expect(s["2026-11-24"]).toBe("green");
  });
  it("builds the evening digest for tomorrow", () => {
    const d = eveningDigest(trip, [alert], {}, thLocal("2026-11-25T20:00"))!;
    expect(d.title).toContain("קניון");
    expect(d.body).toContain("09:30");
  });
});
