// AeroDataBox (via RapidAPI) flight status by number. Needs RAPIDAPI_KEY.
import type { Flight, FlightStatus } from "@trip/shared";

interface Movement {
  airport?: { iata?: string };
  scheduledTime?: { utc?: string };
  revisedTime?: { utc?: string };
  gate?: string;
}

interface FlightContract {
  status?: string;
  departure?: Movement;
}

const ms = (utc?: string) => (utc ? Date.parse(utc.replace(" ", "T").replace(/Z?$/, "Z")) : NaN);

export async function fetchFlightStatus(key: string, flight: Flight): Promise<FlightStatus | null> {
  if (!flight.number || !flight.departLocal) return null;
  const date = flight.departLocal.slice(0, 10);
  const res = await fetch(`https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(flight.number)}/${date}`, {
    headers: { "X-RapidAPI-Key": key, "X-RapidAPI-Host": "aerodatabox.p.rapidapi.com" },
  });
  if (res.status === 204 || res.status === 404) return null;
  if (!res.ok) throw new Error(`aerodatabox ${res.status}`);
  const list = (await res.json()) as FlightContract[];
  const f = list.find((x) => x.departure?.airport?.iata === flight.fromIata) ?? list[0];
  if (!f) return null;
  const delay = (ms(f.departure?.revisedTime?.utc) - ms(f.departure?.scheduledTime?.utc)) / 60_000;
  return { status: f.status ?? "Unknown", delayMin: Number.isFinite(delay) ? Math.max(0, Math.round(delay)) : 0, gate: f.departure?.gate };
}
