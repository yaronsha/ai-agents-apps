// npm run sim:live
//
// The other half of the simulator: calls every real source once through the worker's own fetch
// and parse code, so a changed API format shows up here, and saves the real responses as the
// simulator's new recordings. Free sources always run; paid ones run when their key is set
// (GOOGLE_MAPS_KEY, RAPIDAPI_KEY with LIVE_FLIGHT="EY 432 2026-10-20", ANTHROPIC_API_KEY).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { addDays, thDate } from "@trip/shared";
import { fetchAir, fetchForecasts } from "../../worker/src/sources/openmeteo";
import { fetchQuakes } from "../../worker/src/sources/usgs";
import { fetchAdvisory } from "../../worker/src/sources/fcdo";
import { fetchArticles } from "../../worker/src/sources/gdelt";
import { fetchDriveTime } from "../../worker/src/sources/routes";
import { fetchFlightStatus } from "../../worker/src/sources/flights";
import { triageNews } from "../../worker/src/claude";
import type { Env } from "../../worker/src/env";
import { simTrip } from "./world";

const FIXTURES = new URL("../fixtures/", import.meta.url).pathname;
const SAMPLES = FIXTURES + "live-samples/";
const save = (name: string, body: unknown) =>
  writeFileSync(name, (Array.isArray(body) ? `[\n${body.map((x) => JSON.stringify(x)).join(",\n")}\n]` : JSON.stringify(body, null, 1)) + "\n");

// Keep the last response body of each host, exactly as it came over the wire.
const bodies = new Map<string, unknown>();
const realFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const res = await realFetch(input, init);
  const host = new URL(String(input instanceof Request ? input.url : input)).host;
  const copy = res.clone();
  if (copy.headers.get("content-type")?.includes("json")) bodies.set(host, await copy.json().catch(() => undefined));
  return res;
};

type Row = { source: string; status: "ok" | "skipped" | "failed"; note: string };
const rows: Row[] = [];
const meta = JSON.parse(readFileSync(FIXTURES + "meta.json", "utf8"));
const now = new Date();
const today = thDate(now);

function expect(cond: unknown, what: string): asserts cond {
  if (!cond) throw new Error(`unexpected format: ${what}`);
}

async function source(name: string, run: () => Promise<string>, needs?: string) {
  if (needs && !process.env[needs]) {
    rows.push({ source: name, status: "skipped", note: `no ${needs}` });
    return;
  }
  try {
    rows.push({ source: name, status: "ok", note: await run() });
  } catch (err) {
    rows.push({ source: name, status: "failed", note: String(err) });
  }
}

const stops = simTrip.days.flatMap((d) => d.stops);
const unique = stops.filter((s, i) => stops.findIndex((t) => t.lat === s.lat && t.lng === s.lng) === i);
let anyRecorded = false;
const recorded = (key: string) => {
  meta.sources[key] = { recordedAt: now.toISOString(), origin: "live" };
  anyRecorded = true;
};

await source("weather (Open-Meteo)", async () => {
  const fc = await fetchForecasts(unique, today, addDays(today, 6));
  const first = fc[unique[0].id];
  expect(first && first.time.length === 7 * 24, "7 days of hourly forecast per place");
  expect(first.temp.some((t) => typeof t === "number"), "numeric temperatures");
  save(FIXTURES + "openmeteo-forecast.json", bodies.get("api.open-meteo.com"));
  recorded("weather");
  return `${unique.length} places × 7 days`;
});

await source("air quality (Open-Meteo)", async () => {
  const air = await fetchAir(unique, today, addDays(today, 4));
  expect(air[unique[0].id]?.pm25.some((v) => typeof v === "number"), "numeric PM2.5");
  save(FIXTURES + "openmeteo-air.json", bodies.get("air-quality-api.open-meteo.com"));
  recorded("air");
  return `${unique.length} places × 5 days`;
});

await source("earthquakes (USGS)", async () => {
  const quakes = await fetchQuakes();
  expect(quakes.every((q) => Number.isFinite(q.mag) && Number.isFinite(q.lat) && Number.isFinite(q.timeMs)), "magnitude, position and time on every quake");
  save(FIXTURES + "usgs.json", bodies.get("earthquake.usgs.gov"));
  recorded("usgs");
  return `${quakes.length} M4.5+ quakes in the past day`;
});

await source("travel advice (GOV.UK)", async () => {
  const adv = await fetchAdvisory();
  expect(!Number.isNaN(Date.parse(adv.updatedAt)), "public_updated_at");
  const page = bodies.get("www.gov.uk") as Record<string, unknown>;
  // The full page is large; keep the fields the worker reads plus a few for orientation.
  const { base_path, content_id, document_type, locale, title, description, public_updated_at } = page as Record<string, string>;
  const details = page.details as { change_description?: string };
  save(FIXTURES + "fcdo.json", { base_path, content_id, document_type, locale, title, description, public_updated_at, details: { change_description: details?.change_description } });
  recorded("fcdo");
  return `updated ${adv.updatedAt}: ${adv.description.slice(0, 80)}`;
});

let articles: Awaited<ReturnType<typeof fetchArticles>> = [];
await source("news (GDELT)", async () => {
  // GDELT allows one request every 5 seconds per address, and CI runners share addresses.
  for (let attempt = 1; ; attempt++) {
    try {
      articles = await fetchArticles();
      break;
    } catch (err) {
      if (!/ 429$|limit requests/i.test(String((err as Error).message)) || attempt === 4) throw err;
      await new Promise((r) => setTimeout(r, 6_000 * attempt));
    }
  }
  expect(articles.every((a) => a.url && a.title), "url and title on every article");
  save(FIXTURES + "gdelt.json", bodies.get("api.gdeltproject.org") ?? { articles: [] });
  recorded("gdelt");
  return `${articles.length} headlines in the past 24 hours`;
});

await source(
  "drive times (Google Routes)",
  async () => {
    const out: Record<string, unknown> = {};
    const place = (id: string) => (id.startsWith("lodging:") ? simTrip.lodgings.find((l) => `lodging:${l.id}` === id) : stops.find((s) => s.id === id));
    for (const drive of simTrip.days.flatMap((d) => d.drives)) {
      const reading = await fetchDriveTime(process.env.GOOGLE_MAPS_KEY!, place(drive.fromId)!, place(drive.toId)!, now);
      expect("noRoute" in reading || (reading.durationSec > 0 && reading.staticSec > 0), "duration and staticDuration");
      out[drive.id] = bodies.get("routes.googleapis.com");
    }
    save(FIXTURES + "routes.json", out);
    recorded("routes");
    return `${Object.keys(out).length} drives`;
  },
  "GOOGLE_MAPS_KEY",
);

await source(
  "flight status (AeroDataBox)",
  async () => {
    // The trip's flights are weeks away; check the format on a flight the caller names.
    const [number, date] = (process.env.LIVE_FLIGHT ?? "").split(/ (?=\d{4}-)/);
    expect(number && date, 'LIVE_FLIGHT like "EY 432 2026-10-20"');
    const status = await fetchFlightStatus(process.env.RAPIDAPI_KEY!, { id: "live", number, fromIata: "", toIata: "", departLocal: `${date}T00:00`, departUtcOffset: 0, labelHe: "" });
    expect(status, "a flight in the response");
    mkdirSync(SAMPLES, { recursive: true });
    save(SAMPLES + "aerodatabox.json", bodies.get("aerodatabox.p.rapidapi.com"));
    return `${number}: ${status.status}, delay ${status.delayMin} min, gate ${status.gate ?? "-"}`;
  },
  "RAPIDAPI_KEY",
);

await source(
  "news triage (Claude)",
  async () => {
    const probe = { url: "https://example.com/probe", title: "Landslide closes Route 1095 between Mae Taeng and Pai", domain: "example.com", seendate: "" };
    const env = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, CLAUDE_TRIAGE_MODEL: process.env.CLAUDE_TRIAGE_MODEL ?? "claude-haiku-4-5" } as Env;
    const items = await triageNews(env, simTrip, simTrip.days[3].date, [probe, ...articles.slice(0, 10)]);
    expect(items.some((i) => i.url === probe.url), "the planted Route 1095 landslide marked relevant");
    return `${items.length} of ${articles.length + 1} headlines relevant; the planted one: "${items.find((i) => i.url === probe.url)!.titleHe}"`;
  },
  "ANTHROPIC_API_KEY",
);

if (anyRecorded) {
  meta.recordedAt = now.toISOString();
  meta.origin = "live";
  save(FIXTURES + "meta.json", meta);
}

const icon = { ok: "✓", skipped: "–", failed: "✗" };
for (const r of rows) console.log(`${icon[r.status]} ${r.source}: ${r.note}`);
const failed = rows.filter((r) => r.status === "failed");
console.log(failed.length ? `\n${failed.length} source(s) failed.` : "\nAll reachable sources answered in the format the worker expects. Recordings updated in sim/fixtures/.");
process.exit(failed.length ? 1 : 0);
