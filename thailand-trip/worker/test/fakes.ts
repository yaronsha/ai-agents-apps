import { trip } from "@trip/shared/private";
import type { Env } from "../src/env";

export class FakeKV {
  data = new Map<string, string>();
  writes = 0;
  async get(key: string, type?: "json") {
    const v = this.data.get(key);
    if (v === undefined) return null;
    return type === "json" ? JSON.parse(v) : v;
  }
  async put(key: string, value: string) {
    this.writes++;
    this.data.set(key, value);
  }
}

/** Hourly forecast for one location over the requested dates, with rain on the afternoon of `wetDate`. */
function forecastFor(start: string, end: string, wetDate: string) {
  const time: string[] = [];
  for (let d = new Date(`${start}T00:00:00Z`); d <= new Date(`${end}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    for (let h = 0; h < 24; h++) time.push(`${d.toISOString().slice(0, 10)}T${String(h).padStart(2, "0")}:00`);
  }
  const wet = (t: string) => t.startsWith(wetDate) && t.slice(11, 13) >= "14";
  return {
    hourly: {
      time,
      precipitation_probability: time.map((t) => (wet(t) ? 85 : 10)),
      precipitation: time.map((t) => (wet(t) ? 2.5 : 0)),
      weather_code: time.map((t) => (wet(t) ? 63 : 1)),
      temperature_2m: time.map((t) => (Number(t.slice(11, 13)) < 8 ? 9 : 24)),
      cloud_cover_low: time.map(() => 70),
      cloud_cover_high: time.map(() => 10),
      pm2_5: time.map(() => 22),
    },
  };
}

export interface FetchLog {
  urls: string[];
  pushes: number;
}

export function stubFetch(log: FetchLog, wetDate = "2026-11-26") {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    log.urls.push(url);
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
    const u = new URL(url);
    if (u.host.includes("open-meteo.com")) {
      const n = u.searchParams.get("latitude")!.split(",").length;
      const one = forecastFor(u.searchParams.get("start_date")!, u.searchParams.get("end_date")!, wetDate);
      return json(n === 1 ? one : Array.from({ length: n }, () => one));
    }
    if (u.host === "earthquake.usgs.gov") {
      return json({ features: [{ id: "us7", properties: { mag: 5.8, place: "Shan, Myanmar", time: Date.parse("2026-11-26T04:50:00Z"), url: "https://usgs" }, geometry: { coordinates: [98.2, 20.0, 10] } }] });
    }
    if (u.host === "www.gov.uk") return json({ public_updated_at: "2026-11-20T10:00:00Z", details: { change_description: "Minor edits" } });
    if (u.host === "api.gdeltproject.org") return json({ articles: [] });
    if (init?.method === "POST" && u.host === "push.example") {
      log.pushes++;
      return new Response(null, { status: 201 });
    }
    return json({ error: "unexpected " + url }, 500);
  };
}

export async function makeEnv(kv: FakeKV): Promise<Env> {
  const key = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", key.privateKey);
  return {
    TRIP_KV: kv as unknown as KVNamespace,
    APP_TOKEN: "secret",
    VAPID_PUBLIC_KEY: "x",
    VAPID_PRIVATE_JWK: JSON.stringify(jwk),
    VAPID_CONTACT: "mailto:test@example.com",
    CLAUDE_TRIAGE_MODEL: "claude-haiku-4-5",
    CLAUDE_REPLAN_MODEL: "claude-sonnet-5-5",
    OPENAI_TRIAGE_MODEL: "gpt-5.4-mini",
    OPENAI_REPLAN_MODEL: "gpt-5.5",
  };
}

/** A real-looking browser subscription (keys generated here) pointing at the stubbed push service. */
export async function makeSubscription() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { endpoint: "https://push.example/sub/1", keys: { p256dh: b64(raw), auth: b64(crypto.getRandomValues(new Uint8Array(16))) } };
}

export { trip };
