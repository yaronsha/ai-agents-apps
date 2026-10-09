// Writes starter fixtures in each API's exact response format, for when no real recording exists
// yet (`npm run check:free -- --record` replaces the free sources with real ones). Values follow a
// typical late-November week in northern Thailand: dry, cool mornings, cold summits, some haze.
import { writeFileSync } from "node:fs";
import { simTrip } from "./world";

const FIXTURES = new URL("../fixtures/", import.meta.url).pathname;
// Hourly series stay on one line per place, so a diff of a re-recording stays readable.
const write = (name: string, body: unknown) =>
  writeFileSync(FIXTURES + name, (Array.isArray(body) ? `[\n${body.map((x) => JSON.stringify(x)).join(",\n")}\n]` : JSON.stringify(body, null, 1)) + "\n");
const DAYS = 7;
const stops = simTrip.days.flatMap((d) => d.stops);
const unique = stops.filter((s, i) => stops.findIndex((t) => t.lat === s.lat && t.lng === s.lng) === i);

// A small deterministic random so reseeding gives the same files.
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const time = Array.from({ length: DAYS * 24 }, (_, i) => `2026-11-${String(22 + Math.floor(i / 24)).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00`);
const curve = (h: number) => (Math.cos(((h - 15) / 24) * 2 * Math.PI) + 1) / 2; // 1 at 15:00, 0 at 03:00

const forecast = unique.map((s) => {
  const [lo, hi] = s.highland ? [8, 19] : s.lat > 19.2 && s.lng < 98.6 ? [15, 29] : [17, 30];
  const dayShift = Array.from({ length: DAYS }, () => rnd() * 3 - 1.5);
  return {
    latitude: Number(s.lat.toFixed(3)),
    longitude: Number(s.lng.toFixed(3)),
    generationtime_ms: 0.2,
    utc_offset_seconds: 25200,
    timezone: "Asia/Bangkok",
    timezone_abbreviation: "GMT+7",
    elevation: s.highland ? 1600 : 400,
    hourly_units: { time: "iso8601", precipitation_probability: "%", precipitation: "mm", weather_code: "wmo code", temperature_2m: "°C", cloud_cover_low: "%", cloud_cover_high: "%" },
    hourly: {
      time,
      precipitation_probability: time.map(() => Math.round(rnd() * 12)),
      precipitation: time.map(() => 0),
      weather_code: time.map((_, i) => (i % 24 >= 11 && i % 24 <= 16 ? 2 : 1)),
      temperature_2m: time.map((_, i) => Math.round((lo + (hi - lo) * curve(i % 24) + dayShift[Math.floor(i / 24)]) * 10) / 10),
      cloud_cover_low: time.map((_, i) => (s.highland && i % 24 >= 4 && i % 24 <= 8 ? 55 + Math.round(rnd() * 25) : Math.round(rnd() * 15))),
      cloud_cover_high: time.map(() => Math.round(rnd() * 25)),
    },
  };
});

const air = unique.map((s) => ({
  latitude: Number(s.lat.toFixed(3)),
  longitude: Number(s.lng.toFixed(3)),
  generationtime_ms: 0.1,
  utc_offset_seconds: 25200,
  timezone: "Asia/Bangkok",
  timezone_abbreviation: "GMT+7",
  hourly_units: { time: "iso8601", pm2_5: "μg/m³" },
  hourly: { time, pm2_5: time.map((_, i) => Math.round((22 + 14 * (1 - curve(i % 24)) + rnd() * 6) * 10) / 10) },
}));

const recordedAt = "2026-10-03T20:00:00Z";
const ago = (h: number) => Date.parse(recordedAt) - h * 3_600_000;
const quake = (id: string, mag: number, place: string, lng: number, lat: number, hoursAgo: number) => ({
  type: "Feature",
  properties: { mag, place, time: ago(hoursAgo), updated: ago(hoursAgo - 0.5), tz: null, url: `https://earthquake.usgs.gov/earthquakes/eventpage/${id}`, status: "reviewed", tsunami: 0, sig: 400, net: "us", code: id.slice(2), magType: "mb", type: "earthquake", title: `M ${mag} - ${place}` },
  geometry: { type: "Point", coordinates: [lng, lat, 35] },
  id,
});

write("openmeteo-forecast.json", forecast);
write("openmeteo-air.json", air);
write("usgs.json", {
  type: "FeatureCollection",
  metadata: { generated: Date.parse(recordedAt), url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson", title: "USGS M4.5+ Earthquakes, Past Day", status: 200, api: "1.14.1", count: 3 },
  features: [
    quake("us6000seed1", 5.1, "120 km SW of Abepura, Indonesia", 139.9, -3.4, 5),
    quake("us6000seed2", 4.7, "Kermadec Islands region", -177.6, -29.8, 11),
    quake("us6000seed3", 4.6, "85 km E of Hualien City, Taiwan", 122.4, 23.9, 19),
  ],
});
write("fcdo.json", {
  base_path: "/foreign-travel-advice/thailand",
  content_id: "6d4b4a5a-8d4e-4a52-8d50-0d6f5c0e0a01",
  document_type: "travel_advice",
  locale: "en",
  title: "Thailand travel advice",
  description: "FCDO travel advice for Thailand. Includes safety and security, insurance, entry requirements and legal differences.",
  public_updated_at: "2026-09-18T10:12:00.000+00:00",
  details: { change_description: "Latest update: information on the rainy season ('Extreme weather and natural disasters' section)." },
});
write("gdelt.json", {
  articles: [
    { url: "https://www.example-news.com/chiang-mai-lantern-festival-tickets", url_mobile: "", title: "Chiang Mai lantern festival tickets sell out early", seendate: "20261003T060000Z", socialimage: "", domain: "example-news.com", language: "English", sourcecountry: "Thailand" },
    { url: "https://www.example-news.com/chiang-rai-coffee-harvest", url_mobile: "", title: "Chiang Rai coffee growers expect a strong harvest", seendate: "20261003T041500Z", socialimage: "", domain: "example-news.com", language: "English", sourcecountry: "Thailand" },
  ],
});

// Routes and flights need keys to record; these follow the documented response formats.
const place = (id: string) => (id.startsWith("lodging:") ? simTrip.lodgings.find((l) => `lodging:${l.id}` === id) : stops.find((s) => s.id === id));
const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  Math.hypot((b.lng - a.lng) * 111.32 * Math.cos((a.lat * Math.PI) / 180), (b.lat - a.lat) * 110.57);
write(
  "routes.json",
  Object.fromEntries(
    simTrip.days.flatMap((d) => d.drives).map((dr) => {
      const stat = Math.round((km(place(dr.fromId)!, place(dr.toId)!) * 1.5) / (45 / 3600));
      return [dr.id, { routes: [{ duration: `${Math.round(stat * 1.06)}s`, staticDuration: `${stat}s` }] }];
    }),
  ),
);
write(
  "aerodatabox.json",
  Object.fromEntries(
    simTrip.flights
      .filter((f) => f.departLocal)
      .map((f) => {
        const utc = new Date(Date.parse(`${f.departLocal}:00Z`) - f.departUtcOffset * 3_600_000).toISOString();
        const sched = { utc: `${utc.slice(0, 10)} ${utc.slice(11, 16)}Z`, local: `${f.departLocal!.replace("T", " ")}+0${f.departUtcOffset}:00` };
        return [
          f.id,
          [
            {
              number: f.number?.replace(/^(\D+)/, "$1 "),
              status: "Expected",
              codeshareStatus: "IsOperator",
              isCargo: false,
              departure: { airport: { iata: f.fromIata }, scheduledTime: sched, revisedTime: sched, terminal: "1", gate: "4", quality: ["Basic", "Live"] },
              arrival: { airport: { iata: f.toIata }, quality: ["Basic"] },
              airline: { name: "Etihad Airways", iata: "EY", icao: "ETD" },
            },
          ],
        ];
      }),
  ),
);
const src = (origin: "seed" | "live") => ({ recordedAt, origin });
write("meta.json", {
  recordedAt,
  origin: "seed",
  sources: { weather: src("seed"), air: src("seed"), usgs: src("seed"), fcdo: src("seed"), gdelt: src("seed"), routes: src("seed"), flights: src("seed") },
});
console.log(`fixtures seeded for ${unique.length} places`);
