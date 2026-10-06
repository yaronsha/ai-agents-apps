// Local times are written as "YYYY-MM-DDTHH:mm" in Thailand time (UTC+7, no DST).

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Stop extends LatLng {
  id: string;
  nameHe: string;
  nameEn: string;
  start: string;
  end: string;
  /** Weather can ruin it (trek, viewpoint, outdoor festival). */
  outdoor: boolean;
  /** Summit or highland stop where cold mornings matter. */
  highland?: boolean;
  noteHe?: string;
}

export interface Drive {
  id: string;
  fromId: string;
  toId: string;
  /** Planned departure, local time. */
  departAt: string;
}

export interface Reminder {
  id: string;
  /** When to push the reminder, local time. */
  at: string;
  textHe: string;
}

export interface Day {
  date: string;
  titleHe: string;
  lodgingId: string | null;
  stops: Stop[];
  drives: Drive[];
  reminders: Reminder[];
  /** Ready-made alternatives shown when something goes wrong that day. */
  planB: string[];
}

export interface Lodging extends LatLng {
  id: string;
  name: string;
  checkIn: string;
  checkOut: string;
  bookedVia?: string;
}

export interface Flight {
  id: string;
  /** IATA flight number such as "EY123"; tracking is off until it is filled in. */
  number: string | null;
  fromIata: string;
  toIata: string;
  /** Local departure time; null until known. */
  departLocal: string | null;
  /** UTC offset of the departure airport in hours, used to place departLocal in time. */
  departUtcOffset: number;
  labelHe: string;
}

export interface TripPrivate {
  lodgings: Lodging[];
  flights: Flight[];
}

export interface Trip {
  name: string;
  startDate: string;
  endDate: string;
  days: Day[];
  lodgings: Lodging[];
  flights: Flight[];
}

export type Severity = "urgent" | "warning" | "info";

export type AlertCategory =
  | "weather"
  | "air"
  | "cold"
  | "clouds"
  | "quake"
  | "road"
  | "flight"
  | "news"
  | "advisory"
  | "reminder";

export interface TripAlert {
  /** Stable id so the same event is never pushed twice. */
  id: string;
  category: AlertCategory;
  severity: Severity;
  /** The trip day it affects. */
  date: string;
  stopId?: string;
  titleHe: string;
  bodyHe: string;
  url?: string;
  /** UTC ISO times at which this alert should be pushed (empty = in-app only or evening digest). */
  pushAt: string[];
  /** Include in the 20:00 briefing of the evening before `date`. */
  digest: boolean;
}

export type DayStatus = "green" | "yellow" | "red";

/** Per-stop forecast summary shown in the app. */
export interface StopForecast {
  stopId: string;
  maxRainProb: number | null;
  rainMm: number | null;
  tempMin: number | null;
  tempMax: number | null;
  thunder: boolean;
  pm25Max: number | null;
}

export interface TripState {
  generatedAt: string;
  alerts: TripAlert[];
  dayStatus: Record<string, DayStatus>;
  forecasts: Record<string, StopForecast>;
  sources: Record<string, { ok: boolean; at: string; note?: string }>;
}
