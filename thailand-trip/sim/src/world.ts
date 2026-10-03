// The simulated outside world. Every request the worker makes to the internet lands here and is
// answered from recorded responses (fixtures/), changed by whatever the scenario has made happen
// by the simulated time. The worker's own code parses these exactly as it parses the real thing.
import { readFileSync } from "node:fs";
import { publicTrip, withPrivate, type Trip, type TripPrivate } from "@trip/shared";
import type { Scenario, ScenarioEvent, WeatherPreset } from "./scenario";
import { thLocal } from "./scenario";
import { FakePushService } from "./push";

const FIXTURES = new URL("../fixtures/", import.meta.url).pathname;
const fixture = <T>(name: string): T => JSON.parse(readFileSync(FIXTURES + name, "utf8")) as T;

export const simPrivate = JSON.parse(readFileSync(new URL("../trip-private.sim.json", import.meta.url), "utf8")) as TripPrivate;
export const simTrip: Trip = withPrivate(publicTrip, simPrivate);

interface Meta {
  recordedAt: string;
  origin: "seed" | "live";
  /** Per source: when it was recorded and whether it is a real response or built from the API docs. */
  sources: Record<string, { recordedAt: string; origin: "seed" | "live" }>;
}

type Hourly = Record<string, Array<number | string | null>> & { time: string[] };
interface MeteoLocation {
  latitude: number;
  longitude: number;
  hourly: Hourly;
  [k: string]: unknown;
}

const DAY = 86_400_000;
const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const r = Math.PI / 180;
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6371;
};
const near = <T extends { lat: number; lng: number }>(list: T[], p: { lat: number; lng: number }) =>
  list.reduce((best, x) => (km(x, p) < km(best, p) ? x : best));

const PRESETS: Record<WeatherPreset, Record<string, number>> = {
  storm: { weather_code: 95, precipitation_probability: 90, precipitation: 6, cloud_cover_low: 85, cloud_cover_high: 90 },
  "heavy-rain": { weather_code: 65, precipitation_probability: 85, precipitation: 4, cloud_cover_low: 80, cloud_cover_high: 70 },
  cold: { temperature_2m: 6 },
  smoke: { pm2_5: 130 },
  clear: { weather_code: 1, precipitation_probability: 5, precipitation: 0, cloud_cover_high: 10 },
};

export interface WorldLogEntry {
  at: Date;
  source: string;
  detail?: string;
}

export class World {
  now = new Date(0);
  readonly calls: WorldLogEntry[] = [];
  readonly unexpected: string[] = [];
  readonly push = new FakePushService(() => this.now);
  readonly meta = fixture<Meta>("meta.json");
  private forecast = fixture<MeteoLocation[]>("openmeteo-forecast.json");
  private air = fixture<MeteoLocation[]>("openmeteo-air.json");
  private quakes = fixture<{ features: Array<{ id: string; properties: { time: number }; [k: string]: unknown }> }>("usgs.json");
  private advisory = fixture<{ public_updated_at: string; details?: { change_description?: string }; [k: string]: unknown }>("fcdo.json");
  private gdelt = fixture<{ articles?: Array<Record<string, string>> }>("gdelt.json");
  private routes = fixture<Record<string, { routes?: Array<{ duration: string; staticDuration: string }> }>>("routes.json");
  private flights = fixture<Record<string, Array<Record<string, any>>>>("aerodatabox.json");
  private stops = simTrip.days.flatMap((d) => d.stops);

  constructor(
    private scenario: Scenario,
    private opts: { realClaudeKey?: string } = {},
  ) {}

  /** Scenario events that have happened by now, in order. */
  private happened<K extends string>(key: K): Array<Extract<ScenarioEvent, Record<K, unknown>>> {
    return this.scenario.events.filter((e) => key in e && thLocal(e.at) <= this.now) as never;
  }

  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    const log = (source: string, detail?: string) => this.calls.push({ at: this.now, source, detail });

    switch (url.host) {
      case "api.open-meteo.com":
        log("weather");
        return json(this.meteo(url, this.forecast));
      case "air-quality-api.open-meteo.com":
        log("air");
        return json(this.meteo(url, this.air));
      case "earthquake.usgs.gov":
        log("quakes");
        return json(this.quakeFeed());
      case "www.gov.uk":
        log("advisory");
        return json(this.advisoryPage());
      case "api.gdeltproject.org":
        log("news");
        return json({ articles: this.articles() });
      case "routes.googleapis.com": {
        const body = (await req.json()) as { origin: Waypoint; destination: Waypoint };
        const { id, reply } = this.route(body);
        log("routes", id);
        return json(reply);
      }
      case "aerodatabox.p.rapidapi.com": {
        const [, , , number, date] = url.pathname.split("/");
        log("flights", number);
        const list = this.flight(decodeURIComponent(number), date);
        return list ? json(list) : new Response(null, { status: 204 });
      }
      case "api.anthropic.com":
        log("claude", this.opts.realClaudeKey ? "real" : "simulated");
        return this.claude(req);
      case "push.sim":
        return this.push.receive(req);
    }
    this.unexpected.push(`${req.method} ${url.origin}${url.pathname}`);
    return json({ error: `the simulator has no answer for ${url.host}` }, 502);
  }

  // Open-Meteo: the recorded hours of the nearest recorded place, laid onto the requested dates.
  private meteo(url: URL, recorded: MeteoLocation[]) {
    const lats = url.searchParams.get("latitude")!.split(",").map(Number);
    const lngs = url.searchParams.get("longitude")!.split(",").map(Number);
    const start = url.searchParams.get("start_date")!;
    const end = url.searchParams.get("end_date")!;
    const vars = url.searchParams.get("hourly")!.split(",");
    const recordedDays = recorded[0].hourly.time.length / 24;
    const out = lats.map((lat, i) => {
      const p = { lat, lng: lngs[i] };
      const src = near(recorded.map((r) => ({ ...r, lat: r.latitude, lng: r.longitude })), p);
      const stop = near(this.stops, p);
      const hourly: Hourly = { time: [] };
      for (const v of vars) hourly[v] = [];
      for (let d = Date.parse(`${start}T00:00:00Z`), n = 0; d <= Date.parse(`${end}T00:00:00Z`); d += DAY, n++) {
        const date = new Date(d).toISOString().slice(0, 10);
        const day = Math.round((d - Date.parse(`${publicTrip.startDate}T00:00:00Z`)) / DAY);
        const from = (((day % recordedDays) + recordedDays) % recordedDays) * 24;
        for (let h = 0; h < 24; h++) {
          const time = `${date}T${String(h).padStart(2, "0")}:00`;
          hourly.time.push(time);
          for (const v of vars) hourly[v].push((src.hourly[v]?.[from + h] as number | null) ?? null);
          // What the scenario has done to this stop's forecast so far.
          for (const e of this.happened("weather")) {
            if (!e.weather.stops.includes(stop.id) || time < e.weather.from.slice(0, 13) || time >= e.weather.to) continue;
            for (const [k, val] of Object.entries(PRESETS[e.weather.preset])) {
              if (!vars.includes(k)) continue;
              const arr = hourly[k];
              arr[arr.length - 1] = k === "temperature_2m" ? Math.min(Number(arr[arr.length - 1] ?? val), val) : val;
            }
          }
        }
      }
      return { latitude: src.latitude, longitude: src.longitude, timezone: "Asia/Bangkok", hourly };
    });
    return out.length === 1 ? out[0] : out;
  }

  // USGS: the recorded quakes keep their age relative to now; scenario quakes appear at their time.
  private quakeFeed() {
    const recordedAt = Date.parse(this.meta.sources.usgs.recordedAt);
    const base = this.quakes.features.map((f) => ({ ...f, properties: { ...f.properties, time: this.now.getTime() - (recordedAt - f.properties.time) } }));
    const extra = this.happened("quake")
      .filter((e) => this.now.getTime() - thLocal(e.at).getTime() < DAY)
      .map((e, i) => {
        const stop = this.stops.find((s) => s.id === e.quake.nearStop)!;
        const lng = stop.lng + e.quake.km / (111.32 * Math.cos((stop.lat * Math.PI) / 180));
        return {
          type: "Feature",
          id: `sim${i}${e.at.replace(/\D/g, "")}`,
          properties: { mag: e.quake.mag, place: e.quake.place, time: thLocal(e.at).getTime(), url: "https://earthquake.usgs.gov/earthquakes/eventpage/sim" },
          geometry: { type: "Point", coordinates: [lng, stop.lat, 10] },
        };
      });
    return { ...this.quakes, features: [...extra, ...base] };
  }

  private advisoryPage() {
    const last = this.happened("advisory").at(-1);
    if (!last) return this.advisory;
    return {
      ...this.advisory,
      public_updated_at: thLocal(last.at).toISOString(),
      details: { ...this.advisory.details, change_description: last.advisory.description },
    };
  }

  private articles() {
    const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
    const base = (this.gdelt.articles ?? []).map((a) => ({ ...a, seendate: stamp(new Date(this.now.getTime() - 3 * 3_600_000)) }));
    const fresh = this.happened("news")
      .filter((e) => this.now.getTime() - thLocal(e.at).getTime() < DAY)
      .map((e) => ({
        url: `https://${e.news.domain}/sim/${encodeURIComponent(e.news.title.toLowerCase().replace(/\W+/g, "-"))}`,
        url_mobile: "",
        title: e.news.title,
        seendate: stamp(thLocal(e.at)),
        socialimage: "",
        domain: e.news.domain,
        language: "English",
        sourcecountry: "Thailand",
      }));
    return [...fresh, ...base];
  }

  private route(body: { origin: Waypoint; destination: Waypoint }) {
    const from = latLng(body.origin);
    const to = latLng(body.destination);
    const drive = simTrip.days
      .flatMap((d) => d.drives)
      .find((dr) => {
        const a = place(dr.fromId);
        const b = place(dr.toId);
        return a && b && km(a, from) < 0.05 && km(b, to) < 0.05;
      });
    if (!drive) return { id: "unknown", reply: { routes: [{ duration: `${Math.round(km(from, to) * 80)}s`, staticDuration: `${Math.round(km(from, to) * 80)}s` }] } };
    const base = this.routes[drive.id] ?? { routes: [] };
    const traffic = this.happened("traffic").filter((e) => e.traffic.drive === drive.id).at(-1)?.traffic;
    if (traffic?.closed) return { id: drive.id, reply: {} };
    const r = base.routes?.[0];
    if (!r || !traffic?.slowerPct) return { id: drive.id, reply: base };
    const stat = Number(r.staticDuration.replace("s", ""));
    return { id: drive.id, reply: { routes: [{ ...r, duration: `${Math.round(stat * (1 + traffic.slowerPct / 100))}s` }] } };
  }

  private flight(number: string, date: string) {
    const flight = simPrivate.flights.find((f) => f.number === number);
    const recorded = flight && this.flights[flight.id];
    if (!flight || !recorded || flight.departLocal?.slice(0, 10) !== date) return null;
    const change = Object.assign({}, ...this.happened("flight").filter((e) => e.flight.flight === flight.id).map((e) => e.flight)) as {
      status?: string;
      delayMin?: number;
      gate?: string;
    };
    return recorded.map((f) => {
      const dep = { ...f.departure };
      if (change.delayMin) {
        const sched = Date.parse(String(dep.scheduledTime.utc).replace(" ", "T").replace(/Z?$/, "Z"));
        const revised = new Date(sched + change.delayMin * 60_000).toISOString();
        dep.revisedTime = { utc: `${revised.slice(0, 10)} ${revised.slice(11, 16)}Z`, local: dep.scheduledTime.local };
      }
      if (change.gate) dep.gate = change.gate;
      return { ...f, status: change.status ?? f.status, departure: dep };
    });
  }

  // Claude news triage: the scenario says what each of its headlines means; everything else is noise.
  private async claude(req: Request): Promise<Response> {
    if (this.opts.realClaudeKey) {
      const headers = new Headers(req.headers);
      headers.set("x-api-key", this.opts.realClaudeKey);
      return fetch("https://api.anthropic.com" + new URL(req.url).pathname, { method: req.method, headers, body: await req.text() });
    }
    const body = (await req.json()) as { model: string; messages: Array<{ content: string }> };
    const prompt = body.messages[0].content;
    const headlines = [...prompt.matchAll(/^(\d+)\. \[[^\]]*\] (.*)$/gm)].map((m) => ({ index: Number(m[1]), title: m[2] }));
    const news = this.scenario.events.flatMap((e) => ("news" in e ? [e.news] : []));
    const items = headlines.map(({ index, title }) => {
      const t = news.find((n) => n.title === title)?.triage;
      return t
        ? { index, relevant: true, ...t }
        : { index, relevant: false, severity: "info", affectedDate: "", titleHe: "", bodyHe: "" };
    });
    return new Response(
      JSON.stringify({
        id: `msg_sim_${this.calls.length}`,
        type: "message",
        role: "assistant",
        model: body.model,
        content: [{ type: "text", text: JSON.stringify({ items }) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: Math.ceil(prompt.length / 4), output_tokens: 40 * items.length },
      }),
      { headers: { "Content-Type": "application/json", "request-id": "req_sim" } },
    );
  }
}

type Waypoint = { location: { latLng: { latitude: number; longitude: number } } };
const latLng = (w: Waypoint) => ({ lat: w.location.latLng.latitude, lng: w.location.latLng.longitude });

function place(id: string) {
  if (id.startsWith("lodging:")) return simTrip.lodgings.find((l) => l.id === id.slice(8));
  return simTrip.days.flatMap((d) => d.stops).find((s) => s.id === id);
}
