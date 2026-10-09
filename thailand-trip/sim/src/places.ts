// npm run verify:places
//
// Looks up every stop and hospital on OpenStreetMap (Nominatim) and prints how far the app's
// coordinate is from what OSM has under that name. Run it after editing the itinerary.
// Nominatim allows one request a second, so this takes about a minute. Generic stops (a lunch,
// "Old City temples") have no single place to look up and are skipped. check:free runs it too.
import { pathToFileURL } from "node:url";
import { distanceKm, hospitals, publicTrip } from "@trip/shared";

export const FLAG_KM = 0.5;
// What to search for when nameEn is not a place OSM knows by that name.
const QUERY: Record<string, string | null> = {
  "twin-pagodas": "Phra Maha Chedi Naphamethinidon",
  "mae-klang-luang": "Ban Mae Klang Luang",
  "old-city-night": "Wat Chedi Luang",
  "old-city-temples": "Wat Phra Singh",
  "lantern-festival": "CAD Cultural Center Mae On",
  "pai-loy-krathong": null,
  "khao-soi": null,
  "kok-river-lunch": null,
  "akha-kitchen": null,
  "doi-chang-coffee": "Doi Chang, Mae Suai",
};

type Place = { id: string; name: string; lat: number; lng: number };
/** One place's comparison; km is undefined when OSM has nothing under that name. */
export type PlaceResult = Place & { km?: number; osm?: { lat: number; lng: number; name: string } };

/** Compares every place with OSM, calling `onResult` as each answer comes in. Throws if OSM is unreachable. */
export async function verifyPlaces(onResult: (r: PlaceResult) => void = () => {}): Promise<PlaceResult[]> {
  const places = new Map<string, Place>();
  for (const day of publicTrip.days)
    for (const s of day.stops) if (QUERY[s.id] !== null) places.set(s.id, { id: s.id, name: QUERY[s.id] ?? s.nameEn, lat: s.lat, lng: s.lng });
  for (const h of hospitals) places.set(h.name, { id: h.name, name: h.name, lat: h.lat, lng: h.lng });

  const out: PlaceResult[] = [];
  for (const p of places.values()) {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.search = new URLSearchParams({ q: p.name, format: "jsonv2", limit: "1", countrycodes: "th" }).toString();
    const res = await fetch(url, {
      headers: { "User-Agent": "thailand-trip-verify (github.com/yaronsha/ai-agents-apps)" },
      signal: AbortSignal.timeout(15_000),
    }).catch((e: Error) => {
      throw new Error(`Cannot reach OpenStreetMap: ${e.message}`);
    });
    if (!res.ok) throw new Error(`OpenStreetMap answered ${res.status} for "${p.name}"`);
    const [hit] = (await res.json()) as { lat: string; lon: string; display_name: string }[];
    const r: PlaceResult = hit
      ? { ...p, km: distanceKm(p, { lat: +hit.lat, lng: +hit.lon }), osm: { lat: +hit.lat, lng: +hit.lon, name: hit.display_name } }
      : p;
    out.push(r);
    onResult(r);
    await new Promise((r) => setTimeout(r, 1100));
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const results = await verifyPlaces((r) =>
      console.log(
        r.km === undefined
          ? `?      ${r.id.padEnd(32)} not found as "${r.name}"`
          : `${r.km > FLAG_KM ? "CHECK " : "ok    "}${r.id.padEnd(32)} ${r.km.toFixed(2).padStart(6)} km  OSM ${r.osm!.lat.toFixed(4)}, ${r.osm!.lng.toFixed(4)}  ${r.osm!.name.slice(0, 60)}`,
      ),
    );
    const flagged = results.filter((r) => (r.km ?? 0) > FLAG_KM).length;
    console.log(`\n${flagged} place(s) more than ${FLAG_KM} km from OSM. OSM can be wrong too: open both points on a map before changing one.`);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
