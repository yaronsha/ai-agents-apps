// Temporary diagnostic (not for merge): why GDELT returns no headlines, and whether the itinerary's
// coordinates match where OpenStreetMap puts each place.
import { simTrip } from "./world";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function gdelt(label: string, query: string, extra = "timespan=24h") {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=ArtList&format=json&maxrecords=75&sort=DateDesc&${extra}`;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      if (res.status === 429 || /limit requests/i.test(text)) { await sleep(10_000 * attempt); continue; }
      let n = "?";
      let sample: string[] = [];
      try {
        const j = JSON.parse(text);
        n = String(j.articles?.length ?? 0);
        sample = (j.articles ?? []).slice(0, 4).map((a: { title: string; domain: string; language: string }) => `      - [${a.domain}, ${a.language}] ${a.title.slice(0, 100)}`);
      } catch { n = `not JSON: ${text.slice(0, 120)}`; }
      console.log(`  ${label} (${query.length} chars, ${extra}): HTTP ${res.status}, ${n} articles`);
      sample.forEach((s) => console.log(s));
      await sleep(6_000);
      return;
    } catch (err) { console.log(`  ${label}: ${err}`); await sleep(10_000); }
  }
  console.log(`  ${label}: still rate-limited`);
}

console.log("GDELT");
const PLACES = '("Chiang Mai" OR "Chiang Rai" OR "Mae Hong Son")';
const TROUBLE = "(protest OR closed OR flood OR landslide OR accident OR cancelled OR evacuation OR wildfire OR border)";
await gdelt("A current query", `${PLACES} ${TROUBLE}`);
await gdelt("B current query, 7 days", `${PLACES} ${TROUBLE}`, "timespan=7d");
await gdelt("C places only", PLACES);
await gdelt("D \"Chiang Mai\" only", '"Chiang Mai"');
await gdelt("E places, English sources", `${PLACES} sourcelang:english`);
await gdelt("F places + flood only", `${PLACES} flood`);
await gdelt("G Thailand, 3 words", "Thailand (flood OR landslide OR protest)");

console.log("\nCoordinates vs OpenStreetMap (Nominatim)");
const haversine = (a: number, b: number, c: number, d: number) => {
  const r = Math.PI / 180, dLat = (c - a) * r, dLng = (d - b) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};
const stops = simTrip.days.flatMap((d) => d.stops);
for (const s of stops) {
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=th&q=${encodeURIComponent(s.nameEn)}`, {
    headers: { "User-Agent": "thailand-trip-sim/1.0 (github.com/yaronsha/ai-agents-apps)" },
  });
  const hits = (await res.json().catch(() => [])) as { lat: string; lon: string; display_name: string }[];
  if (!hits.length) console.log(`  ?  ${s.id} "${s.nameEn}": not found`);
  else {
    const km = haversine(s.lat, s.lng, +hits[0].lat, +hits[0].lon);
    console.log(`  ${km > 3 ? "✗" : "✓"}  ${s.id} "${s.nameEn}": ${km.toFixed(1)} km from OSM (${hits[0].display_name.slice(0, 70)})`);
  }
  await sleep(1_100);
}
