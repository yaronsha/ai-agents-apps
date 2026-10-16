// Which stops the place check looks up on the web, and when. During the trip: today's and tomorrow's
// stops at 06:00 and 14:00 (Thai time). Before it: every stop, once a week on Monday at 06:00, to catch
// changes to the hours, fees and closures gathered in shared/src/place-facts.ts.
import { addDays, placeFacts, placeInfo, thParts, type PlaceFacts, type Trip } from "@trip/shared";
import type { PlaceTarget } from "./claude";

/** Stops per AI call: each gets up to two searches, and one call allows ten. */
export const PLACES_PER_CALL = 5;

export function placeCheckDates(trip: Trip, now: Date): string[] {
  const { date: today, hour, minute } = thParts(now);
  if (minute >= 15) return [];
  const tripDates = trip.days.map((d) => d.date);
  if (today >= addDays(trip.startDate, -1) && today <= trip.endDate) {
    return hour === 6 || hour === 14 ? tripDates.filter((d) => d === today || d === addDays(today, 1)) : [];
  }
  const monday = new Date(`${today}T12:00:00Z`).getUTCDay() === 1;
  return today < trip.startDate && monday && hour === 6 ? tripDates : [];
}

function knownHe(f: PlaceFacts): string {
  const hours = f.hoursHe ?? (f.hours ? `${f.hours.open}-${f.hours.close}` : "");
  return [hours && `שעות: ${hours}`, f.closedNoteHe, f.feeHe && `כניסה: ${f.feeHe}`, f.payHe && `תשלום: ${f.payHe}`].filter(Boolean).join("; ");
}

export function placeTargets(trip: Trip, dates: string[]): PlaceTarget[] {
  return trip.days
    .filter((d) => dates.includes(d.date))
    .flatMap((d) =>
      d.stops.flatMap((s) => {
        const f = placeFacts(s.id);
        if (!f || f.watch === false) return [];
        return [
          {
            stopId: s.id,
            date: d.date,
            start: s.start,
            end: s.end,
            nameEn: s.nameEn,
            nameTh: placeInfo(s.id)?.nameTh,
            lat: s.lat,
            lng: s.lng,
            known: knownHe(f),
            officialUrls: f.officialUrls ?? [],
          },
        ];
      }),
    );
}
