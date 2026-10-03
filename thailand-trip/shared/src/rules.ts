// Turns raw readings into alerts, and decides when each alert becomes a push.
// Pure functions: the worker feeds them data, the tests feed them fixtures.
import type { Day, DayStatus, Drive, Flight, Stop, StopForecast, Trip, TripAlert } from "./types";
import { addDays, addHours, deferPastQuiet, eveningBefore, hhmm, localAt, thDate, thLocal } from "./time";
import { distanceKm, placeOf } from "./trip";

export const RULES = {
  rainProbPct: 70,
  rainMm: 5,
  thunderCode: 95,
  coldC: 12,
  pm25: 50,
  quakeMag: 5,
  quakeKm: 300,
  quakeMaxAgeHours: 3,
  trafficRatio: 1.3,
  flightDelayMin: 30,
  /** A push whose time passed more than this long ago is dropped instead of sent late. */
  staleHours: 2,
} as const;

export interface HourlyForecast {
  /** Thailand local times, "YYYY-MM-DDTHH:mm". */
  time: string[];
  precipProb: Array<number | null>;
  precip: Array<number | null>;
  code: Array<number | null>;
  temp: Array<number | null>;
  lowCloud?: Array<number | null>;
  highCloud?: Array<number | null>;
}

export interface HourlyAir {
  time: string[];
  pm25: Array<number | null>;
}

function hoursIn(stop: Pick<Stop, "start" | "end">, times: string[]): number[] {
  const from = stop.start.slice(0, 13);
  const to = stop.end;
  const idx: number[] = [];
  times.forEach((t, i) => {
    if (t.slice(0, 13) >= from && t <= to) idx.push(i);
  });
  return idx;
}

const nums = (xs: Array<number | null | undefined>) => xs.filter((x): x is number => typeof x === "number");
const max = (xs: number[]) => (xs.length ? Math.max(...xs) : null);
const min = (xs: number[]) => (xs.length ? Math.min(...xs) : null);

export function summarizeStop(stop: Stop, fc?: HourlyForecast, air?: HourlyAir): StopForecast {
  const idx = fc ? hoursIn(stop, fc.time) : [];
  const pick = (arr?: Array<number | null>) => nums(idx.map((i) => arr?.[i]));
  const airIdx = air ? hoursIn(stop, air.time) : [];
  const rain = pick(fc?.precip);
  return {
    stopId: stop.id,
    maxRainProb: max(pick(fc?.precipProb)),
    rainMm: rain.length ? Math.round(rain.reduce((a, b) => a + b, 0) * 10) / 10 : null,
    tempMin: min(pick(fc?.temp)),
    tempMax: max(pick(fc?.temp)),
    thunder: pick(fc?.code).some((c) => c >= RULES.thunderCode),
    pm25Max: max(nums(airIdx.map((i) => air?.pm25[i]))),
  };
}

/** Evening briefing the day before, plus a push 2 hours before the stop (moved out of quiet hours). */
export function warningPushes(date: string, start: Date): string[] {
  const times = [eveningBefore(date), deferPastQuiet(addHours(start, -2))];
  const iso = [...new Set(times.map((d) => d.toISOString()))];
  return iso.sort();
}

export function weatherAlerts(day: Day, summaries: Record<string, StopForecast>): TripAlert[] {
  const out: TripAlert[] = [];
  for (const stop of day.stops) {
    const s = summaries[stop.id];
    if (!stop.outdoor || !s) continue;
    const wet = (s.maxRainProb ?? 0) >= RULES.rainProbPct && (s.rainMm ?? 0) >= RULES.rainMm;
    if (!s.thunder && !wet) continue;
    const what = s.thunder ? "סופת רעמים" : `גשם (${s.maxRainProb}%, כ-${s.rainMm} מ"מ)`;
    out.push({
      id: `weather:${stop.id}:${s.thunder ? "storm" : "rain"}`,
      category: "weather",
      severity: "warning",
      date: day.date,
      stopId: stop.id,
      titleHe: `${what} צפוי ב${stop.nameHe}`,
      bodyHe: `בין ${hhmm(stop.start)} ל-${hhmm(stop.end)}. ${day.planB[0] ?? ""}`.trim(),
      pushAt: warningPushes(day.date, thLocal(stop.start)),
      digest: true,
    });
  }
  return out;
}

export function coldAlerts(day: Day, summaries: Record<string, StopForecast>): TripAlert[] {
  return day.stops
    .filter((s) => s.highland && (summaries[s.id]?.tempMin ?? 99) < RULES.coldC)
    .map((s) => ({
      id: `cold:${s.id}`,
      category: "cold" as const,
      severity: "info" as const,
      date: day.date,
      stopId: s.id,
      titleHe: `קר ב${s.nameHe}: עד ${Math.round(summaries[s.id].tempMin!)} מעלות`,
      bodyHe: "לקחת סווטשרט או מעיל.",
      pushAt: [],
      digest: true,
    }));
}

export function airAlerts(day: Day, summaries: Record<string, StopForecast>): TripAlert[] {
  return day.stops
    .filter((s) => (summaries[s.id]?.pm25Max ?? 0) > RULES.pm25)
    .map((s) => ({
      id: `air:${s.id}`,
      category: "air" as const,
      severity: "info" as const,
      date: day.date,
      stopId: s.id,
      titleHe: `איכות אוויר ירודה ב${s.nameHe}`,
      bodyHe: `PM2.5 עד ${Math.round(summaries[s.id].pm25Max!)} מק"ג/מ"ק. כדאי מסכה, ופחות מאמץ בחוץ.`,
      pushAt: [],
      digest: true,
    }));
}

export type CloudSeaChance = "high" | "medium" | "low";

/**
 * Heuristic for a "sea of clouds" below a summit at sunrise: plenty of low cloud
 * (below the summit) with clear sky above. Not a real forecast product.
 */
export function cloudSeaChance(stop: Stop, fc: HourlyForecast): CloudSeaChance | null {
  const idx = fc.time
    .map((t, i) => [t, i] as const)
    .filter(([t]) => t.slice(0, 10) === stop.start.slice(0, 10) && t.slice(11, 13) >= "05" && t.slice(11, 13) <= "07")
    .map(([, i]) => i);
  const low = max(nums(idx.map((i) => fc.lowCloud?.[i])));
  const high = max(nums(idx.map((i) => fc.highCloud?.[i])));
  if (low === null || high === null) return null;
  if (low >= 50 && high < 40) return "high";
  if (low >= 25 && high < 70) return "medium";
  return "low";
}

export function cloudSeaAlert(day: Day, stop: Stop, chance: CloudSeaChance): TripAlert {
  const he = { high: "גבוה", medium: "בינוני", low: "נמוך" }[chance];
  return {
    id: `clouds:${stop.id}:${chance}`,
    category: "clouds",
    severity: chance === "low" ? "warning" : "info",
    date: day.date,
    stopId: stop.id,
    titleHe: `סיכוי ${he} לים עננים ב${stop.nameHe}`,
    bodyHe: chance === "low" ? (day.planB[0] ?? "אפשר לשקול לוותר על ההשכמה.") : "שווה לקום.",
    pushAt: [],
    digest: true,
  };
}

export interface Quake {
  id: string;
  mag: number;
  lat: number;
  lng: number;
  timeMs: number;
  place: string;
  url: string;
}

export function quakeAlerts(trip: Trip, quakes: Quake[], now: Date): TripAlert[] {
  const today = thDate(now);
  const day = trip.days.find((d) => d.date === today);
  if (!day) return [];
  const points = [...day.stops, ...(day.lodgingId ? [placeOf(trip, `lodging:${day.lodgingId}`)!] : [])].filter(Boolean);
  return quakes
    .filter((q) => q.mag >= RULES.quakeMag && now.getTime() - q.timeMs <= RULES.quakeMaxAgeHours * 3_600_000)
    .flatMap((q) => {
      const km = Math.min(...points.map((p) => distanceKm(p, q)));
      if (km > RULES.quakeKm) return [];
      return [
        {
          id: `quake:${q.id}`,
          category: "quake" as const,
          severity: "urgent" as const,
          date: today,
          titleHe: `רעידת אדמה בעוצמה ${q.mag.toFixed(1)}, כ-${Math.round(km)} ק"מ מכם`,
          bodyHe: `${q.place}. להתרחק ממבנים פגועים וממדרונות, לבדוק שכולם בסדר, ולעקוב אחרי הודעות מקומיות.`,
          url: q.url,
          pushAt: [now.toISOString()],
          digest: false,
        },
      ];
    });
}

export type RouteReading = { durationSec: number; staticSec: number } | { noRoute: true };

export function routeAlert(trip: Trip, drive: Drive, date: string, reading: RouteReading, now: Date): TripAlert | null {
  const to = placeOf(trip, drive.toId);
  const toName = to?.nameHe ?? "היעד";
  if ("noRoute" in reading) {
    return {
      id: `road:${drive.id}:noroute`,
      category: "road",
      severity: "urgent",
      date,
      titleHe: `לא נמצא מסלול נסיעה ל${toName}`,
      bodyHe: "ייתכן שהכביש חסום. כדאי לבדוק עם הנהג לפני היציאה.",
      pushAt: [now.toISOString()],
      digest: false,
    };
  }
  const ratio = reading.durationSec / reading.staticSec;
  if (ratio < RULES.trafficRatio) return null;
  const extraMin = Math.round((reading.durationSec - reading.staticSec) / 60 / 5) * 5;
  return {
    id: `road:${drive.id}:slow`,
    category: "road",
    severity: "urgent",
    date,
    titleHe: `הנסיעה ל${toName} ארוכה מהרגיל בכ-${extraMin} דקות`,
    bodyHe: `כדאי לצאת כ-${extraMin} דקות לפני ${hhmm(drive.departAt)}.`,
    pushAt: [now.toISOString()],
    digest: false,
  };
}

export interface FlightStatus {
  status: string;
  delayMin: number;
  gate?: string;
}

export function flightAlerts(flight: Flight, status: FlightStatus, previousGate: string | undefined, now: Date): TripAlert[] {
  if (!flight.departLocal) return [];
  const date = thDate(localAt(flight.departLocal, flight.departUtcOffset));
  const base = { category: "flight" as const, severity: "urgent" as const, date, pushAt: [now.toISOString()], digest: false };
  const out: TripAlert[] = [];
  if (/cancel/i.test(status.status)) {
    out.push({ ...base, id: `flight:${flight.id}:cancel`, titleHe: `הטיסה ${flight.labelHe} בוטלה`, bodyHe: "לפנות לדלפק Etihad ולחברת הביטוח." });
  } else if (status.delayMin >= RULES.flightDelayMin) {
    const bucket = Math.floor(status.delayMin / 30) * 30;
    out.push({ ...base, id: `flight:${flight.id}:delay${bucket}`, titleHe: `הטיסה ${flight.labelHe} מתעכבת בכ-${status.delayMin} דקות`, bodyHe: "לבדוק את הקונקשן באבו דאבי ואת ההסעות." });
  }
  if (status.gate && previousGate && status.gate !== previousGate) {
    out.push({ ...base, id: `flight:${flight.id}:gate:${status.gate}`, titleHe: `שער חדש לטיסה ${flight.labelHe}: ${status.gate}`, bodyHe: `במקום ${previousGate}.` });
  }
  return out;
}

const ROUTE_AREAS = /chiang mai|chiang rai|mae hong son|pai\b|chiang dao|north(ern)? thailand|phu chi fa|myanmar border|laos border/i;

export function advisoryAlert(change: { updatedAt: string; description: string; url: string }, now: Date): TripAlert {
  const onRoute = ROUTE_AREAS.test(change.description);
  return {
    id: `advisory:${change.updatedAt}`,
    category: "advisory",
    severity: onRoute ? "urgent" : "info",
    date: thDate(now),
    titleHe: onRoute ? "שינוי באזהרת המסע שנוגע לאזור הטיול" : "עדכון באזהרת המסע הבריטית לתאילנד",
    bodyHe: change.description,
    url: change.url,
    pushAt: onRoute ? [now.toISOString()] : [],
    digest: !onRoute,
  };
}

export interface NewsItem {
  url: string;
  date: string;
  severity: "urgent" | "warning" | "info";
  titleHe: string;
  bodyHe: string;
}

export function newsAlerts(items: NewsItem[], now: Date): TripAlert[] {
  const today = thDate(now);
  return items.map((n) => {
    const soon = n.date === today || n.date === addDays(today, 1);
    const urgent = n.severity === "urgent" && soon;
    return {
      id: `news:${n.url}`,
      category: "news" as const,
      severity: urgent ? ("urgent" as const) : n.severity === "info" ? ("info" as const) : ("warning" as const),
      date: n.date,
      titleHe: n.titleHe,
      bodyHe: n.bodyHe,
      url: n.url,
      pushAt: urgent ? [now.toISOString()] : [],
      digest: !urgent,
    };
  });
}

export function reminderAlerts(trip: Trip): TripAlert[] {
  return trip.days.flatMap((d) =>
    d.reminders.map((r) => ({
      id: `reminder:${r.id}`,
      category: "reminder" as const,
      severity: "info" as const,
      date: d.date,
      titleHe: "תזכורת",
      bodyHe: r.textHe,
      pushAt: [thLocal(r.at).toISOString()],
      digest: false,
    })),
  );
}

export function dayStatuses(trip: Trip, alerts: TripAlert[]): Record<string, DayStatus> {
  const out: Record<string, DayStatus> = {};
  for (const d of trip.days) {
    const mine = alerts.filter((a) => a.date === d.date && a.category !== "reminder");
    out[d.date] = mine.some((a) => a.severity === "urgent") ? "red" : mine.some((a) => a.severity === "warning") ? "yellow" : "green";
  }
  return out;
}

export interface DuePush {
  key: string;
  alert: TripAlert;
}

/** Pushes that are due now and were not sent yet. Late pushes older than RULES.staleHours are dropped. */
export function duePushes(alerts: TripAlert[], now: Date, sent: Set<string>): DuePush[] {
  const out: DuePush[] = [];
  for (const alert of alerts) {
    alert.pushAt.forEach((iso, i) => {
      const key = `${alert.id}#${i}`;
      const at = new Date(iso).getTime();
      const age = now.getTime() - at;
      if (sent.has(key) || age < 0 || age > RULES.staleHours * 3_600_000) return;
      out.push({ key, alert });
    });
  }
  return out;
}

/** The 20:00 briefing about tomorrow. */
export function eveningDigest(trip: Trip, alerts: TripAlert[], summaries: Record<string, StopForecast>, now: Date): { title: string; body: string } | null {
  const tomorrow = addDays(thDate(now), 1);
  const day = trip.days.find((d) => d.date === tomorrow);
  if (!day) return null;
  const first = day.drives[0]?.departAt ?? day.stops[0]?.start;
  const temps = nums(day.stops.flatMap((s) => [summaries[s.id]?.tempMin, summaries[s.id]?.tempMax]));
  const lines = [
    first ? `יציאה ב-${hhmm(first)}.` : "",
    temps.length ? `טמפרטורות ${Math.round(Math.min(...temps))}-${Math.round(Math.max(...temps))} מעלות.` : "",
    ...alerts.filter((a) => a.date === tomorrow && a.digest).map((a) => `• ${a.titleHe}`),
  ].filter(Boolean);
  return { title: `מחר: ${day.titleHe}`, body: lines.join("\n") || "אין שינויים מהתוכנית." };
}
