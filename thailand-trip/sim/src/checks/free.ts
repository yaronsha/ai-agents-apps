// npm run check:free [-- --record] [-- --skip-places]
//
// Local, by-hand check of the free (no key) sources the worker reads. Each source goes through the
// worker's own fetch and parse code (format), its values are checked for plausibility
// (correctness), and where a keyless independent source exists the two are compared
// (reliability). News compares GDELT with Google News RSS and prints the numbers side by side.
// --record also saves the answers as the simulator's recordings (fixtures/*.json, meta.json).
// --skip-places skips the OpenStreetMap comparison of every stop and hospital (~1 minute).
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { addDays, distanceKm, thDate, type HourlyForecast, type Quake } from "@trip/shared";
import { fetchAir, fetchForecasts } from "../../../worker/src/sources/openmeteo";
import { fetchQuakes } from "../../../worker/src/sources/usgs";
import { FCDO_PAGE, fetchAdvisory } from "../../../worker/src/sources/fcdo";
import { fetchArticles, type Article } from "../../../worker/src/sources/gdelt";
import { fetchGoogleNews } from "../../../worker/src/sources/googlenews";
import { simTrip } from "../world";
import { FLAG_KM, verifyPlaces } from "../places";
import { REPORTS, Report, expect, flag, recordBodies, sleep, warnUnless } from "./common";

const RECORD = flag("record");
const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname;
const UA = "thailand-trip-check github.com/yaronsha/ai-agents-apps";
const HOUR = 3_600_000;
const save = (name: string, body: unknown) =>
  writeFileSync(name, (Array.isArray(body) ? `[\n${body.map((x) => JSON.stringify(x)).join(",\n")}\n]` : JSON.stringify(body, null, 1)) + "\n");

const bodies = recordBodies();
const report = new Report("Live check: free sources");
const meta = JSON.parse(readFileSync(FIXTURES + "meta.json", "utf8"));
const now = new Date();
const today = thDate(now);
const recorded = (key: string, file: string, body: unknown) => {
  if (!RECORD) return;
  save(FIXTURES + file, body);
  meta.sources[key] = { recordedAt: now.toISOString(), origin: "live" };
};
const skipAfter = (source: string, ...levels: Array<"correctness" | "reliability">) =>
  levels.forEach((l) => report.skip(source, l, "format check failed"));

async function getText(url: string, headers: Record<string, string> = {}): Promise<{ status: number; text: string }> {
  const res = await fetch(url, { headers: { "User-Agent": UA, ...headers }, signal: AbortSignal.timeout(20_000) });
  return { status: res.status, text: await res.text() };
}

const stops = simTrip.days.flatMap((d) => d.stops);
const unique = stops.filter((s, i) => stops.findIndex((t) => t.lat === s.lat && t.lng === s.lng) === i);
const nearestStop = (p: { lat: number; lng: number }) => unique.reduce((a, b) => (distanceKm(a, p) <= distanceKm(b, p) ? a : b));
const fmt = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : "-");

// ---- Weather ----
const WEATHER = "weather (Open-Meteo)";
let forecasts: Record<string, HourlyForecast> = {};
if (
  await report.check(WEATHER, "format", async () => {
    forecasts = await fetchForecasts(unique, today, addDays(today, 6));
    const first = forecasts[unique[0].id];
    expect(first && first.time.length === 7 * 24, "7 days of hourly forecast per place");
    expect(first.temp.some((t) => typeof t === "number"), "numeric temperatures");
    recorded("weather", "openmeteo-forecast.json", bodies.get("api.open-meteo.com"));
    return `${unique.length} places × 7 days`;
  })
) {
  await report.check(WEATHER, "correctness", async () => {
    const bad: string[] = [];
    let lo = Infinity, hi = -Infinity;
    for (const s of unique) {
      const fc = forecasts[s.id];
      if (!fc) { bad.push(`${s.id}: missing`); continue; }
      if (fc.time.length !== 168) bad.push(`${s.id}: ${fc.time.length} hours`);
      const temps = fc.temp.filter((t): t is number => typeof t === "number");
      if (!temps.length) bad.push(`${s.id}: all temperatures null`);
      if (!fc.precip.some((p) => typeof p === "number")) bad.push(`${s.id}: all precipitation null`);
      temps.forEach((t) => ((lo = Math.min(lo, t)), (hi = Math.max(hi, t))));
      if (temps.some((t) => t < 0 || t > 42)) bad.push(`${s.id}: temperature outside 0–42 °C`);
      if (fc.precip.some((p) => typeof p === "number" && p < 0)) bad.push(`${s.id}: negative precipitation`);
    }
    expect(!bad.length, bad.slice(0, 5).join("; "));
    return `temperatures ${fmt(lo)}–${fmt(hi)} °C across ${unique.length} places, precipitation ≥ 0, 168 hours each`;
  });

  await report.check(WEATHER, "reliability", async () => {
    // MET Norway (yr.no) is an independent model; compare the next 24 hours at three stops.
    const refs = [
      { name: "Chiang Mai old city", lat: 18.7883, lng: 98.9853 },
      { name: "Pai", lat: 19.3583, lng: 98.44 },
      { name: "Chiang Rai", lat: 19.9105, lng: 99.8406 },
    ];
    const notes: string[] = [];
    let worst = 0;
    const rainDisagree: string[] = [];
    for (const ref of refs) {
      const stop = nearestStop(ref);
      const fc = forecasts[stop.id];
      const { status, text } = await getText(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${stop.lat.toFixed(4)}&lon=${stop.lng.toFixed(4)}`);
      if (status !== 200) throw new Error(`api.met.no ${status}: ${text.slice(0, 120)}`);
      const met = JSON.parse(text) as {
        properties: { timeseries: Array<{ time: string; data: { instant: { details: { air_temperature: number } }; next_1_hours?: { details: { precipitation_amount: number } } } }> };
      };
      const metAt = new Map(met.properties.timeseries.map((t) => [Date.parse(t.time), t.data]));
      const diffs: number[] = [];
      let omRain = 0, metRain = 0;
      fc.time.forEach((t, i) => {
        const ms = Date.parse(`${t}:00+07:00`);
        if (ms < now.getTime() || ms > now.getTime() + 24 * HOUR) return;
        const m = metAt.get(ms);
        if (!m) return;
        if (typeof fc.temp[i] === "number") diffs.push(Math.abs(fc.temp[i]! - m.instant.details.air_temperature));
        omRain += fc.precip[i] ?? 0;
        metRain += m.next_1_hours?.details.precipitation_amount ?? 0;
      });
      expect(diffs.length >= 12, `${ref.name}: only ${diffs.length} matching hours with MET Norway`);
      const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      worst = Math.max(worst, mean);
      // Loosely: one says clearly wet (≥ 2 mm), the other clearly dry (< 0.5 mm).
      if ((omRain >= 2 && metRain < 0.5) || (metRain >= 2 && omRain < 0.5)) rainDisagree.push(`${ref.name} (Open-Meteo ${fmt(omRain)} mm, MET ${fmt(metRain)} mm)`);
      notes.push(`${ref.name} (${stop.id}): mean |Δt| ${fmt(mean)} °C over ${diffs.length} h, rain 24h ${fmt(omRain)} vs ${fmt(metRain)} mm`);
      await sleep(500);
    }
    const note = `vs MET Norway: ${notes.join("; ")}`;
    expect(worst <= 6, `temperatures disagree by more than 6 °C. ${note}`);
    warnUnless(worst <= 3, `temperatures disagree by more than 3 °C. ${note}`);
    warnUnless(!rainDisagree.length, `rain yes/no disagrees at ${rainDisagree.join(", ")}. ${note}`);
    return note;
  });
} else skipAfter(WEATHER, "correctness", "reliability");

// ---- Air quality ----
const AIR = "air quality (Open-Meteo)";
let air: Awaited<ReturnType<typeof fetchAir>> = {};
if (
  await report.check(AIR, "format", async () => {
    air = await fetchAir(unique, today, addDays(today, 4));
    expect(air[unique[0].id]?.pm25.some((v) => typeof v === "number"), "numeric PM2.5");
    recorded("air", "openmeteo-air.json", bodies.get("air-quality-api.open-meteo.com"));
    return `${unique.length} places × 5 days`;
  })
) {
  await report.check(AIR, "correctness", async () => {
    const bad: string[] = [];
    let hi = 0;
    for (const s of unique) {
      const v = (air[s.id]?.pm25 ?? []).filter((x): x is number => typeof x === "number");
      if (!v.length) bad.push(`${s.id}: all PM2.5 null`);
      if (v.some((x) => x < 0 || x > 1000)) bad.push(`${s.id}: PM2.5 outside 0–1000`);
      hi = Math.max(hi, ...v);
    }
    expect(!bad.length, bad.slice(0, 5).join("; "));
    return `PM2.5 within 0–1000 at every place, highest ${fmt(hi)} µg/m³`;
  });
  report.skip(AIR, "reliability", "no keyless independent source: OpenAQ v3 needs a key, WAQI's demo token is not for real use");
} else skipAfter(AIR, "correctness", "reliability");

// ---- Earthquakes ----
const QUAKES = "earthquakes (USGS)";
let quakes: Quake[] = [];
let feedGenerated = now.getTime();
if (
  await report.check(QUAKES, "format", async () => {
    quakes = await fetchQuakes();
    expect(quakes.every((q) => Number.isFinite(q.mag) && Number.isFinite(q.lat) && Number.isFinite(q.timeMs)), "magnitude, position and time on every quake");
    const body = bodies.get("earthquake.usgs.gov") as { metadata?: { generated?: number } };
    feedGenerated = body?.metadata?.generated ?? feedGenerated;
    recorded("usgs", "usgs.json", body);
    return `${quakes.length} M4.5+ quakes in the past day`;
  })
) {
  await report.check(QUAKES, "correctness", async () => {
    const bad = quakes.filter(
      (q) =>
        !Number.isFinite(q.mag) || q.mag < 4.4 || q.mag > 10 ||
        Math.abs(q.lat) > 90 || Math.abs(q.lng) > 180 ||
        q.timeMs > feedGenerated + 60_000 || q.timeMs < feedGenerated - 25 * HOUR,
    );
    expect(!bad.length, `implausible: ${bad.slice(0, 3).map((q) => `${q.id} M${q.mag} ${q.lat},${q.lng} ${new Date(q.timeMs).toISOString()}`).join("; ")}`);
    const age = (now.getTime() - feedGenerated) / 60_000;
    warnUnless(age < 30, `feed generated ${fmt(age, 0)} min ago`);
    return `magnitudes 4.5–10, valid positions, all within the feed's 24 h; feed ${fmt(age, 0)} min old`;
  });

  await report.check(QUAKES, "reliability", async () => {
    const start = new Date(now.getTime() - 24 * HOUR).toISOString().slice(0, 19);
    const { status, text } = await getText(`https://www.seismicportal.eu/fdsnws/event/1/query?format=json&minmag=4.5&starttime=${start}&limit=200`);
    if (status !== 200 && status !== 204) throw new Error(`seismicportal.eu ${status}: ${text.slice(0, 120)}`);
    const emsc = status === 204 ? [] : (JSON.parse(text) as { features: Array<{ properties: { time: string; mag: number; lat: number; lon: number; flynn_region: string } }> }).features.map((f) => ({
      timeMs: Date.parse(f.properties.time), mag: f.properties.mag, lat: f.properties.lat, lng: f.properties.lon, place: f.properties.flynn_region,
    }));
    const match = (q: { timeMs: number; lat: number; lng: number }) =>
      emsc.find((e) => Math.abs(e.timeMs - q.timeMs) <= 2 * 60_000 && distanceKm(e, q) <= 100);
    // Stay clear of the window's edge, where the two feeds' 24 hours do not line up.
    const big = quakes.filter((q) => q.mag >= 5 && q.timeMs > now.getTime() - 23 * HOUR);
    const pairs = big.map((q) => ({ q, e: match(q) }));
    const matched = pairs.filter((p) => p.e);
    const magOff = matched.filter((p) => Math.abs(p.q.mag - p.e!.mag) > 0.5);
    const maxDiff = Math.max(0, ...matched.map((p) => Math.abs(p.q.mag - p.e!.mag)));
    const nearUs = (p: { lat: number; lng: number }) => unique.some((s) => distanceKm(s, p) <= 300);
    const regional = [
      ...quakes.filter(nearUs).map((q) => `USGS M${q.mag} ${q.place} ${new Date(q.timeMs).toISOString().slice(0, 16)}Z${match(q) ? "" : " (not in EMSC)"}`),
      ...emsc.filter((e) => nearUs(e) && !quakes.some((q) => Math.abs(e.timeMs - q.timeMs) <= 2 * 60_000 && distanceKm(e, q) <= 100))
        .map((e) => `EMSC only M${e.mag} ${e.place} ${new Date(e.timeMs).toISOString().slice(0, 16)}Z`),
    ];
    const note =
      `EMSC has ${emsc.length} M4.5+; of ${big.length} USGS M5+ quakes EMSC has ${matched.length}, max mag diff ${fmt(maxDiff)}` +
      (pairs.length > matched.length ? `; missing: ${pairs.filter((p) => !p.e).map((p) => `M${p.q.mag} ${p.q.place}`).join(", ")}` : "") +
      `. Within 300 km of the route: ${regional.length ? regional.join("; ") : "none"}`;
    warnUnless(!magOff.length, `magnitudes differ by more than 0.5: ${magOff.map((p) => `${p.q.place} USGS ${p.q.mag} vs EMSC ${p.e!.mag}`).join(", ")}. ${note}`);
    warnUnless(matched.length >= Math.ceil(big.length * 0.8), `EMSC lacks some USGS M5+ quakes. ${note}`);
    return note;
  });
} else skipAfter(QUAKES, "correctness", "reliability");

// ---- UK travel advice ----
const FCDO = "travel advice (GOV.UK)";
let advisory: Awaited<ReturnType<typeof fetchAdvisory>> | undefined;
let page: Record<string, unknown> = {};
if (
  await report.check(FCDO, "format", async () => {
    advisory = await fetchAdvisory();
    expect(!Number.isNaN(Date.parse(advisory.updatedAt)), "public_updated_at");
    page = bodies.get("www.gov.uk") as Record<string, unknown>;
    // The full page is large; keep the fields the worker reads plus a few for orientation.
    const { base_path, content_id, document_type, locale, title, description, public_updated_at } = page as Record<string, string>;
    const details = page.details as { change_description?: string };
    recorded("fcdo", "fcdo.json", { base_path, content_id, document_type, locale, title, description, public_updated_at, details: { change_description: details?.change_description } });
    return `updated ${advisory.updatedAt}: ${advisory.description.slice(0, 80)}`;
  })
) {
  await report.check(FCDO, "correctness", async () => {
    expect(page.base_path === "/foreign-travel-advice/thailand", `base_path is ${String(page.base_path)}`);
    expect(Date.parse(advisory!.updatedAt) <= now.getTime() + 60_000, `public_updated_at ${advisory!.updatedAt} is in the future`);
    return `base_path ${page.base_path}, updated ${advisory!.updatedAt}`;
  });
  await report.check(FCDO, "reliability", async () => {
    const { status, text } = await getText(FCDO_PAGE);
    expect(status === 200, `${FCDO_PAGE} answered ${status}`);
    expect(/Thailand/.test(text), `${FCDO_PAGE} does not mention Thailand`);
    const days = (now.getTime() - Date.parse(advisory!.updatedAt)) / (24 * HOUR);
    const note = `the public page answers and mentions Thailand; last update ${fmt(days, 0)} days ago`;
    warnUnless(days <= 120, `stale: ${note}`);
    return note;
  });
} else skipAfter(FCDO, "correctness", "reliability");

// ---- News ----
const ROUTE = [
  "Chiang Mai", "Chiang Rai", "Mae Hong Son", "Pai", "Doi Inthanon", "Chiang Dao", "Mae Taeng", "Doi Suthep",
  ...unique.map((s) => s.nameEn).filter((n) => !/lunch|kitchen|old city|night bazaar|walking street|airport/i.test(n)),
];
const routeRe = new RegExp(`\\b(${[...new Set(ROUTE)].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i");
const OUTLETS = [
  "bangkokpost.com", "nationthailand.com", "thethaiger.com", "khaosodenglish.com", "chiangraitimes.com", "reuters.com", "apnews.com",
  "pattayamail.com", "thaipbsworld.com", "thaiexaminer.com", "chiangmaicitylife.com", "aljazeera.com", "cnn.com", "nytimes.com",
  "theguardian.com", "scmp.com", "channelnewsasia.com", "afp.com", "khaosod.co.th", "thairath.co.th", "mgronline.com",
];
const isOutlet = (domain: string) => /(^|\.)bbc\.(com|co\.uk)$/.test(domain) || OUTLETS.some((o) => domain === o || domain.endsWith(`.${o}`));
const seenMs = (s: string) => (/^\d{8}T\d{6}Z$/.test(s) ? Date.parse(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`) : Date.parse(s));

interface Variant { name: string; articles?: Article[]; error?: string }
const stats = (a: Article[]) => {
  const times = a.map((x) => seenMs(x.seendate)).filter(Number.isFinite);
  const domains = new Set(a.map((x) => x.domain));
  return {
    count: a.length,
    newestH: times.length ? (now.getTime() - Math.max(...times)) / HOUR : NaN,
    route: a.filter((x) => routeRe.test(x.title)).length,
    domains: domains.size,
    outlets: a.filter((x) => isOutlet(x.domain)).length,
    outletDomains: [...domains].filter(isOutlet).length,
  };
};
const statNote = (a: Article[]) => {
  const s = stats(a);
  return `${s.count} headlines, newest ${fmt(s.newestH)} h old, ${s.route} mention the route, ${s.domains} domains`;
};

async function gdelt(timespan: string): Promise<Article[]> {
  // One request every 5 seconds per address, and it sometimes drops the connection: retry those.
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetchArticles(timespan);
    } catch (err) {
      if (!/ 429\b|limit requests|fetch failed/i.test(String((err as Error).message)) || attempt === 5) throw err;
      await sleep(15_000 * attempt);
    }
  }
}

const variants: Variant[] = [];
for (const [name, run] of [
  // Google between the two GDELT calls spaces them further apart.
  ["GDELT 24h", () => gdelt("24h")],
  ["Google 1d", () => fetchGoogleNews(1)],
  ["Google 3d", () => fetchGoogleNews(3)],
  ["GDELT 3d", () => gdelt("3d")],
] as const) {
  const v: Variant = { name };
  variants.push(v);
  await report.check(`news (${name})`, "format", async () => {
    try {
      v.articles = await run();
    } catch (err) {
      v.error = (err as Error).message;
      throw err;
    }
    expect(v.articles.every((a) => a.url && a.title && a.domain), "url, title and domain on every article");
    expect(v.articles.every((a) => Number.isFinite(seenMs(a.seendate))), "a parseable date on every article");
    if (name === "GDELT 24h") recorded("gdelt", "gdelt.json", bodies.get("api.gdeltproject.org") ?? { articles: [] });
    return statNote(v.articles);
  });
  if (name.startsWith("GDELT")) await sleep(6_000);
}
const [g24, n1, n3, g3] = variants;

if (g24.articles)
  await report.check("news (GDELT 24h)", "correctness", async () => {
    const s = stats(g24.articles!);
    warnUnless(s.count > 0, `no headlines in the past 24 hours (GDELT's index has lagged ~37 h before); 3d has ${g3.articles?.length ?? "?"}, newest ${g3.articles ? fmt(stats(g3.articles).newestH) : "?"} h old`);
    warnUnless(s.newestH <= 24, `newest headline is ${fmt(s.newestH)} h old: GDELT's index lags`);
    return `newest headline ${fmt(s.newestH)} h old`;
  });
else skipAfter("news (GDELT 24h)", "correctness");
if (n1.articles)
  await report.check("news (Google 1d)", "correctness", async () => {
    const s = stats(n1.articles!);
    warnUnless(s.count > 0, "no headlines in the past day");
    warnUnless(s.newestH <= 24, `newest headline is ${fmt(s.newestH)} h old`);
    return `newest headline ${fmt(s.newestH)} h old`;
  });
else skipAfter("news (Google 1d)", "correctness");

// The same story under both sources: enough of the significant title words in common.
const STOP = new Set("the and for with from that this after into over amid near says said will have been their about more than what when were they thai thailand".split(" "));
const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(" ").filter((w) => w.length >= 4 && !STOP.has(w)));
const same = (a: string, b: string) => {
  const x = words(a), y = words(b);
  const common = [...x].filter((w) => y.has(w)).length;
  return common >= 3 && common / Math.min(x.size, y.size) >= 0.5;
};
const overlap = (a: Article[], b: Article[]) => a.filter((x) => b.some((y) => same(x.title, y.title))).length;

if (g3.articles && n3.articles)
  await report.check("news (GDELT vs Google)", "reliability", async () => {
    const pairs = [[g24, n1], [g3, n3]].filter(([a, b]) => a.articles && b.articles);
    return pairs
      .map(([a, b]) => `${a.name} ∩ ${b.name}: ${overlap(a.articles!, b.articles!)} of ${a.articles!.length} GDELT stories also in Google, ${overlap(b.articles!, a.articles!)} of ${b.articles!.length} Google in GDELT`)
      .join("; ");
  });
else report.skip("news (GDELT vs Google)", "reliability", "one of the 3-day fetches failed");

for (const v of [g3, n3]) {
  if (!v.articles) { report.skip(`news (${v.name})`, "reliability", "fetch failed"); continue; }
  await report.check(`news (${v.name})`, "reliability", async () => {
    const s = stats(v.articles!);
    const top = Object.entries(v.articles!.reduce<Record<string, number>>((m, a) => ((m[a.domain] = (m[a.domain] ?? 0) + 1), m), {}))
      .sort((a, b) => b[1] - a[1]).slice(0, 6).map(([d, n]) => `${d} ${n}`).join(", ");
    const note = `${s.outlets} of ${s.count} from known news outlets (${s.outletDomains} of ${s.domains} domains); top: ${top || "-"}`;
    warnUnless(!s.count || s.outlets > 0, `no known news outlet. ${note}`);
    return note;
  });
}

// ---- Coordinates ----
const PLACES = "coordinates (OSM Nominatim)";
const FAIL_KM = 2;
if (flag("skip-places")) report.skip(PLACES, "reliability", "--skip-places");
else
  await report.check(PLACES, "reliability", async () => {
    process.stdout.write("Comparing stops and hospitals with OpenStreetMap (~1 min) ");
    const results = await verifyPlaces(() => process.stdout.write("."));
    console.log();
    const found = results.filter((r) => r.km !== undefined).sort((a, b) => b.km! - a.km!);
    const missing = results.filter((r) => r.km === undefined).map((r) => r.id);
    const worst = found.slice(0, 3).map((r) => `${r.id} ${fmt(r.km!, 2)} km`).join(", ");
    const note = `${found.length} places compared, ${missing.length} not found on OSM${missing.length ? ` (${missing.join(", ")})` : ""}; farthest: ${worst}`;
    // OSM is a cross-check, not the truth (PR #27 verified pins against several listings): a few
    // hundred metres is usually the size of the place, so only a far miss fails.
    const list = (rs: typeof found) => rs.map((r) => `${r.id} ${fmt(r.km!, 2)} km`).join(", ");
    const far = found.filter((r) => r.km! > FAIL_KM);
    const near = found.filter((r) => r.km! > FLAG_KM && r.km! <= FAIL_KM);
    expect(!far.length, `${far.length} place(s) more than ${FAIL_KM} km from OSM: ${list(far)}. Check both points on a map (OSM may have matched another place). ${note}`);
    warnUnless(!near.length, `${near.length} place(s) ${FLAG_KM}-${FAIL_KM} km from OSM: ${list(near)}. ${note}`);
    return note;
  });

if (RECORD) {
  meta.recordedAt = now.toISOString();
  meta.origin = "live";
  save(FIXTURES + "meta.json", meta);
}

const code = report.finish("live-free.md");

// The numbers to choose a news source by, side by side.
const cols = [g24, g3, n1, n3].map((v) => ({ v, s: v.articles ? stats(v.articles) : undefined }));
const lines: Array<[string, (s: ReturnType<typeof stats>) => string]> = [
  ["headlines", (s) => String(s.count)],
  ["newest (h old)", (s) => fmt(s.newestH)],
  ["mention the route", (s) => String(s.route)],
  ["distinct domains", (s) => String(s.domains)],
  ["from known outlets", (s) => String(s.outlets)],
];
const table = [
  ["", ...cols.map((c) => c.v.name)],
  ...lines.map(([label, f]) => [label, ...cols.map((c) => (c.s ? f(c.s) : `error`))]),
  ["overlap with the other", fmt(g24.articles && n1.articles ? overlap(g24.articles, n1.articles) : NaN, 0), fmt(g3.articles && n3.articles ? overlap(g3.articles, n3.articles) : NaN, 0), fmt(g24.articles && n1.articles ? overlap(n1.articles, g24.articles) : NaN, 0), fmt(g3.articles && n3.articles ? overlap(n3.articles, g3.articles) : NaN, 0)],
];
const w = table[0].map((_, i) => Math.max(...table.map((r) => r[i].length)));
console.log(`\nNews sources side by side\n\n${table.map((r) => r.map((c, i) => (i ? c.padStart(w[i]) : c.padEnd(w[i]))).join("  ")).join("\n")}`);
const errors = [g24, g3, n1, n3].filter((v) => v.error).map((v) => `${v.name}: ${v.error}`);
if (errors.length) console.log(`\n${errors.join("\n")}`);
appendFileSync(
  REPORTS + "live-free.md",
  ["", "## News sources side by side", "", `| ${table[0].join(" | ")} |`, `| ${table[0].map(() => "---").join(" | ")} |`, ...table.slice(1).map((r) => `| ${r.join(" | ")} |`), ""].join("\n"),
);
if (RECORD) console.log("Recordings updated in sim/fixtures/.");
process.exit(code);
