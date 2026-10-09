// News shadow mode: once an hour, log what each candidate news source returns, so GDELT and
// Google News can be compared over a few weeks before one replaces the other. It never raises
// an alert or sends a push; the only side effect is one KV write per hourly run.
import { thDate, thParts } from "@trip/shared";
import { trip } from "@trip/shared/private";
import type { Env } from "./env";
import { Store } from "./store";
import { fetchArticles, type Article } from "./sources/gdelt";
import { fetchGoogleNews } from "./sources/googlenews";
import { aiProvider, triageNews } from "./ai";
import { DAILY_CAPS } from "./engine";

const MIN = 60_000;
const TTL_DAYS = 45;
/** GDELT allows one request per 5 seconds from an IP. */
const GDELT_GAP_MS = 6_000;
const TIMEOUT_MS = 8_000;
/** Shadow triage is one call per source with headlines (2 sources), once a day, inside the engine's budget. */
const AI_SOURCES = ["google-1d", "gdelt-24h"] as const;
const AI_FROM_HOUR = 8;

export interface ShadowHeadline {
  title: string;
  domain: string;
  date: string;
}

export interface ShadowSource {
  ok: boolean;
  error?: string;
  ms: number;
  count: number;
  /** Minutes since the newest headline was published (or indexed, for GDELT). */
  newestAgeMin: number | null;
  routeMentions: number;
  titles: ShadowHeadline[];
}

export interface ShadowAi {
  ok: boolean;
  error?: string;
  sent: number;
  relevant: number;
  titles: string[];
}

export interface ShadowRecord {
  at: string;
  hour: number;
  sources: Record<string, ShadowSource>;
  ai?: Record<string, ShadowAi>;
  error?: string;
}

export const shadowKey = (date: string) => `shadow:news:${date}`;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PLACES = [
  ...new Set(["Chiang Mai", "Chiang Rai", "Mae Hong Son", "Pai", "Doi Inthanon", "Chiang Dao", ...trip.days.flatMap((d) => d.stops.map((s) => s.nameEn))]),
];
const ROUTE = new RegExp(`(?<!\\w)(${PLACES.map(escape).join("|")})(?!\\w)`, "i");

/** GDELT's "20261009T101500Z" or an ISO date, as epoch ms. */
function published(seendate: string): number {
  const m = seendate.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  return Date.parse(m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : seendate);
}

/** The source functions take no signal, so the timeout races them instead of aborting the request. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  const signal = AbortSignal.timeout(ms);
  return Promise.race([
    p,
    new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error(`timeout after ${ms / 1000} s`)))),
  ]);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function probe(fetcher: () => Promise<Article[]>, now: Date, keep: Map<string, Article[]>, name: string): Promise<ShadowSource> {
  const start = Date.now();
  try {
    const articles = await withTimeout(fetcher(), TIMEOUT_MS);
    keep.set(name, articles);
    const times = articles.map((a) => published(a.seendate)).filter((t) => !Number.isNaN(t));
    return {
      ok: true,
      ms: Date.now() - start,
      count: articles.length,
      newestAgeMin: times.length ? Math.round((now.getTime() - Math.max(...times)) / MIN) : null,
      routeMentions: articles.filter((a) => ROUTE.test(a.title)).length,
      titles: articles.slice(0, 10).map((a) => ({
        title: a.title.slice(0, 120),
        domain: a.domain.slice(0, 40),
        date: Number.isNaN(published(a.seendate)) ? "" : new Date(published(a.seendate)).toISOString().slice(0, 16),
      })),
    };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 200), ms: Date.now() - start, count: 0, newestAgeMin: null, routeMentions: 0, titles: [] };
  }
}

export interface ShadowOptions {
  /** The engine already called GDELT in this run, so wait before the first GDELT call too. */
  gdeltCalled?: boolean;
  /** Pause between GDELT calls (tests set 0). */
  gapMs?: number;
}

export async function runShadow(env: Env, now: Date, opts: ShadowOptions = {}): Promise<ShadowRecord | null> {
  const { hour, minute } = thParts(now);
  if ((env.SHADOW_NEWS ?? "on").toLowerCase() === "off" || minute >= 15) return null;
  const store = new Store(env.TRIP_KV);
  const today = thDate(now);
  const key = shadowKey(today);
  const records = await store.json<ShadowRecord[]>(key, []);
  const gap = opts.gapMs ?? GDELT_GAP_MS;
  const record: ShadowRecord = { at: now.toISOString(), hour, sources: {} };
  const articles = new Map<string, Article[]>();

  try {
    // Google and GDELT are different hosts, so the first pair runs in parallel; worst case
    // (timeouts and both gaps) stays near 30 s, well within a cron run's wall time.
    const [google, gdelt1] = await Promise.all([
      probe(() => fetchGoogleNews(1), now, articles, "google-1d"),
      (opts.gdeltCalled ? sleep(gap) : Promise.resolve()).then(() => probe(() => fetchArticles("24h"), now, articles, "gdelt-24h")),
    ]);
    await sleep(gap);
    const gdelt3 = await probe(() => fetchArticles("3d"), now, articles, "gdelt-3d");
    record.sources = { "google-1d": google, "gdelt-24h": gdelt1, "gdelt-3d": gdelt3 };

    // Once a day, from 08:00: how many of each source's past-day headlines would triage keep?
    const aiDone = records.some((r) => r.ai);
    if ((env.SHADOW_AI ?? "off").toLowerCase() === "on" && hour >= AI_FROM_HOUR && !aiDone && aiProvider(env)) {
      record.ai = {};
      const budgetKey = `budget:${today}`;
      const budgetBefore = await store.json<Record<string, number>>(budgetKey, {});
      const budget = { ...budgetBefore };
      for (const name of AI_SOURCES) {
        const fresh = (articles.get(name) ?? []).filter((a) => now.getTime() - published(a.seendate) <= 24 * 60 * MIN).slice(0, 25);
        if (!fresh.length) {
          record.ai[name] = { ok: true, sent: 0, relevant: 0, titles: [] };
          continue;
        }
        if ((budget.claude ?? 0) >= DAILY_CAPS.claude) {
          record.ai[name] = { ok: false, error: "daily AI cap reached", sent: fresh.length, relevant: 0, titles: [] };
          continue;
        }
        budget.claude = (budget.claude ?? 0) + 1;
        try {
          const items = await withTimeout(triageNews(env, trip, today, fresh), 30_000);
          const byUrl = new Map(fresh.map((a) => [a.url, a.title]));
          record.ai[name] = { ok: true, sent: fresh.length, relevant: items.length, titles: items.map((i) => (byUrl.get(i.url) ?? i.titleHe).slice(0, 120)) };
        } catch (err) {
          record.ai[name] = { ok: false, error: String(err).slice(0, 200), sent: fresh.length, relevant: 0, titles: [] };
        }
      }
      await store.putIfChanged(budgetKey, budget, budgetBefore);
    }
  } catch (err) {
    record.error = String(err).slice(0, 200);
  }

  await env.TRIP_KV.put(key, JSON.stringify([...records, record]), { expirationTtl: TTL_DAYS * 24 * 3600 });
  return record;
}

/** Stored records for the last `days` Thailand dates, oldest first. */
export async function shadowLog(env: Env, now: Date, days: number): Promise<Record<string, ShadowRecord[]>> {
  const store = new Store(env.TRIP_KV);
  const dates = Array.from({ length: days }, (_, i) => thDate(new Date(now.getTime() - (days - 1 - i) * 24 * 60 * MIN)));
  const values = await Promise.all(dates.map((d) => store.json<ShadowRecord[] | null>(shadowKey(d), null)));
  return Object.fromEntries(dates.flatMap((d, i) => (values[i] ? [[d, values[i]]] : [])));
}
