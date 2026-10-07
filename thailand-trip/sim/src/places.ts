// npm run verify:places
//
// Looks up every stop and hospital on OpenStreetMap (Nominatim) and prints how far the app's
// coordinate is from what OSM has under that name. Run it after editing the itinerary.
// Nominatim allows one request a second, so this takes about a minute. Generic stops (a lunch,
// "Old City temples") have no single place to look up and are skipped.
import { distanceKm, hospitals, publicTrip } from "@trip/shared";

const FLAG_KM = 0.5;
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
const places = new Map<string, Place>();
for (const day of publicTrip.days)
  for (const s of day.stops) if (QUERY[s.id] !== null) places.set(s.nameEn, { id: s.id, name: QUERY[s.id] ?? s.nameEn, lat: s.lat, lng: s.lng });
for (const h of hospitals) places.set(h.name, { id: h.name, name: h.name, lat: h.lat, lng: h.lng });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let flagged = 0;
for (const p of places.values()) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({ q: p.name, format: "jsonv2", limit: "1", countrycodes: "th" }).toString();
  const res = await fetch(url, {
    headers: { "User-Agent": "thailand-trip-verify (github.com/yaronsha/ai-agents-apps)" },
    signal: AbortSignal.timeout(15_000),
  }).catch((e: Error) => {
    console.error(`Cannot reach OpenStreetMap: ${e.message}`);
    process.exit(1);
  });
  if (!res.ok) {
    console.error(`OpenStreetMap answered ${res.status} for "${p.name}"`);
    process.exit(1);
  }
  const [hit] = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  if (!hit) {
    console.log(`?      ${p.id.padEnd(32)} not found as "${p.name}"`);
  } else {
    const km = distanceKm(p, { lat: +hit.lat, lng: +hit.lon });
    if (km > FLAG_KM) flagged++;
    console.log(`${km > FLAG_KM ? "CHECK " : "ok    "}${p.id.padEnd(32)} ${km.toFixed(2).padStart(6)} km  OSM ${(+hit.lat).toFixed(4)}, ${(+hit.lon).toFixed(4)}  ${hit.display_name.slice(0, 60)}`);
  }
  await sleep(1100);
}
console.log(`\n${flagged} place(s) more than ${FLAG_KM} km from OSM. OSM can be wrong too: open both points on a map before changing one.`);
