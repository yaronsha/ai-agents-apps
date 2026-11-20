// Which stops (and restaurant picks, see shared/src/picks.ts) the place check looks up on the web, and when. During the trip: today's and tomorrow's
// stops at 06:00 and 14:00 (Thai time). Before it: every stop, once a week on Monday at 06:00, to catch
// changes to the hours, fees and closures gathered in shared/src/place-facts.ts.
import { addDays, PICKS, placeFacts, placeInfo, thParts, type PlaceFacts, type Trip } from "@trip/shared";
import type { PlaceTarget } from "./prompts";

/** Stops per AI call: each gets up to two searches, and one call allows ten. */
export const PLACES_PER_CALL = 5;

/**
 * Which trip days the web check looks at in this run. Before the trip it is every stop on Monday
 * mornings; `lastFailed` repeats it the next morning, so one failed run doesn't wait a week.
 */
export function placeCheckDates(trip: Trip, now: Date, lastFailed = false): string[] {
  const { date: today, hour, minute } = thParts(now);
  if (minute >= 15) return [];
  const tripDates = trip.days.map((d) => d.date);
  if (today >= addDays(trip.startDate, -1) && today <= trip.endDate) {
    return hour === 6 || hour === 14 ? tripDates.filter((d) => d === today || d === addDays(today, 1)) : [];
  }
  const monday = new Date(`${today}T12:00:00Z`).getUTCDay() === 1;
  return today < trip.startDate && (monday || lastFailed) && hour === 6 ? tripDates : [];
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
    )
    .concat(
      // Yaron's restaurant picks beside the plan, on the day they are suggested for. The one that is a
      // stop is already covered above. A visit is the suggested time plus an hour.
      PICKS.filter((p) => !p.stopId && dates.includes(p.date) && p.facts.watch !== false).map((p) => ({
        stopId: p.id,
        date: p.date,
        start: p.at,
        end: `${p.date}T${String(Number(p.at.slice(11, 13)) + 1).padStart(2, "0")}${p.at.slice(13)}`,
        nameEn: p.nameEn,
        nameTh: p.nameTh,
        lat: p.lat,
        lng: p.lng,
        known: knownHe(p.facts),
        officialUrls: p.facts.officialUrls ?? [],
      })),
    );
}
