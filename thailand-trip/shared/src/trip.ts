import type { Day, LatLng, Stop, Trip } from "./types";
import { addDays, thDate } from "./time";

export function dayOf(trip: Trip, date: string): Day | undefined {
  return trip.days.find((d) => d.date === date);
}

/** Resolves a stop id or "lodging:<id>" to coordinates. */
export function placeOf(trip: Trip, id: string): (LatLng & { nameHe: string }) | undefined {
  if (id.startsWith("lodging:")) {
    const l = trip.lodgings.find((x) => x.id === id.slice("lodging:".length));
    return l && { lat: l.lat, lng: l.lng, nameHe: l.name };
  }
  for (const day of trip.days) {
    const s = day.stops.find((x) => x.id === id);
    if (s) return s;
  }
  return undefined;
}

export function allStops(trip: Trip): Array<Stop & { date: string }> {
  return trip.days.flatMap((d) => d.stops.map((s) => ({ ...s, date: d.date })));
}

/** The trip day to show by default: today during the trip, otherwise the first or last day. */
export function defaultDate(trip: Trip, now: Date): string {
  const today = thDate(now);
  const first = trip.days[0].date;
  const last = trip.days[trip.days.length - 1].date;
  if (today < first) return first;
  if (today > last) return last;
  return today;
}

/** Days from `now` that the engine watches closely (today and tomorrow, Thailand time). */
export function watchedDates(now: Date): string[] {
  const today = thDate(now);
  return [today, addDays(today, 1)];
}

const EARTH_KM = 6371;
export function distanceKm(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

export function googleMapsDirections(p: LatLng): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
}
