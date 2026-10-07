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
        sample = (j.articles ?? []).slice(0, 3).map((a: { title: string; domain: string; language: string; seendate: string }) => `      - ${a.seendate} [${a.domain}, ${a.language}] ${a.title.slice(0, 80)}`);
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
await gdelt("A \"Thailand\" 24h", "Thailand");
await gdelt("B \"Thailand\" 3 days", "Thailand", "timespan=3d");
await gdelt("C current query, 3 days", `${PLACES} ${TROUBLE}`, "timespan=3d");
await gdelt("D current query, 7 days", `${PLACES} ${TROUBLE}`, "timespan=7d");

console.log("\nWhat OpenStreetMap has at each stop's coordinates");
const haversine = (a: number, b: number, c: number, d: number) => {
  const r = Math.PI / 180, dLat = (c - a) * r, dLng = (d - b) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};
const stops = simTrip.days.flatMap((d) => d.stops);
for (const s of stops) {
  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=17&accept-language=en&lat=${s.lat}&lon=${s.lng}`, {
    headers: { "User-Agent": "thailand-trip-sim/1.0 (github.com/yaronsha/ai-agents-apps)" },
  });
  const hit = (await res.json().catch(() => ({}))) as { display_name?: string; name?: string };
  console.log(`  ${s.id} "${s.nameEn}" @ ${s.lat},${s.lng} -> ${hit.name ? `"${hit.name}" | ` : ""}${(hit.display_name ?? "nothing").slice(0, 90)}`);
  await sleep(1_100);
}
