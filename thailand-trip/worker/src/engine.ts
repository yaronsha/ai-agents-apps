// One check of everything, run by the cron every 15 minutes (and on demand from the app).
import {
  addDays,
  advisoryAlert,
  airAlerts,
  cloudSeaAlert,
  cloudSeaChance,
  coldAlerts,
  dayStatuses,
  duePushes,
  eveningDigest,
  flightAlerts,
  localAt,
  newsAlerts,
  placeOf,
  quakeAlerts,
  reminderAlerts,
  routeAlert,
  summarizeStop,
  thDate,
  thLocal,
  thParts,
  weatherAlerts,
  type HourlyAir,
  type HourlyForecast,
  type NewsItem,
  type StopForecast,
  type TripAlert,
  type TripState,
} from "@trip/shared";
import { trip } from "@trip/shared/private";
import type { Env } from "./env";
import { Store } from "./store";
import { sendToAll } from "./push";
import { fetchAir, fetchForecasts } from "./sources/openmeteo";
import { fetchQuakes } from "./sources/usgs";
import { fetchAdvisory } from "./sources/fcdo";
import { fetchGoogleNews } from "./sources/googlenews";
import { fetchDriveTime } from "./sources/routes";
import { fetchFlightStatus } from "./sources/flights";
import { aiProvider, triageNews } from "./ai";

const MIN = 60_000;

/** Daily caps on paid calls, so a bug can never run up a bill. */
export const DAILY_CAPS = { routes: 100, flights: 60, claude: 60 } as const;
// Every unseen headline goes to the cheap filter in one call (Google News returns at most 100), so
// on a busy day older headlines can't pass the 30-hour cutoff while waiting for their turn.
const NEWS_BATCH = 100;
type Budget = Record<keyof typeof DAILY_CAPS, number>;

interface WeatherCache {
  at: number;
  forecasts: Record<string, HourlyForecast>;
  air: Record<string, HourlyAir>;
}

interface FlightCache {
  gates: Record<string, string>;
  alerts: TripAlert[];
}

export interface RunOptions {
  /**
   * Compute and return the state without sending pushes or saving anything. Paid sources
   * (Claude, Routes, flights) are skipped: a dry run saves no budget, so it must not spend any.
   */
  dryRun?: boolean;
}

export async function runCheck(env: Env, now: Date, opts: RunOptions = {}): Promise<TripState> {
  const store = new Store(env.TRIP_KV);
  const today = thDate(now);
  const { hour, minute } = thParts(now);
  const hourly = minute < 15 || opts.dryRun;
  const sources: TripState["sources"] = {};
  const note = (name: string, ok: boolean, msg?: string) => (sources[name] = { ok, at: now.toISOString(), note: msg });
  const tripDay = trip.days.some((d) => d.date === today);
  const newsWindow = today >= addDays(trip.startDate, -7) && today <= trip.endDate;

  const budgetKey = `budget:${today}`;
  const budgetBefore = await store.json<Budget>(budgetKey, { routes: 0, flights: 0, claude: 0 });
  const budget = { ...budgetBefore };
  const spend = (k: keyof Budget) => (budget[k] < DAILY_CAPS[k] ? (budget[k]++, true) : false);

  // Weather and air quality: refreshed hourly, for trip days inside the forecast range.
  let weather = await store.json<WeatherCache | null>("cache:weather", null);
  if (!weather || now.getTime() - weather.at > 55 * MIN || opts.dryRun) {
    const start = today > trip.days[0].date ? today : trip.days[0].date;
    const end = [addDays(today, 15), trip.endDate].sort()[0];
    const airEnd = [addDays(today, 4), trip.endDate].sort()[0];
    const daysIn = (to: string) => trip.days.filter((d) => d.date >= start && d.date <= to);
    const points = (to: string) => daysIn(to).flatMap((d) => d.stops);
    try {
      const [forecasts, air] = await Promise.all([
        start <= end ? fetchForecasts(points(end), start, end) : {},
        start <= airEnd ? fetchAir(points(airEnd), start, airEnd) : {},
      ]);
      weather = { at: now.getTime(), forecasts, air };
      if (!opts.dryRun) await env.TRIP_KV.put("cache:weather", JSON.stringify(weather));
      note("weather", true, start > end ? "הטיול עוד רחוק מטווח התחזית" : undefined);
    } catch (err) {
      note("weather", false, String(err));
    }
  }

  const summaries: Record<string, StopForecast> = {};
  const alerts: TripAlert[] = [];
  for (const day of trip.days) {
    for (const stop of day.stops) {
      const fc = weather?.forecasts[stop.id];
      if (fc) summaries[stop.id] = summarizeStop(stop, fc, weather?.air[stop.id]);
      // Early highland stops are sunrise viewpoints: estimate the chance of a sea of clouds.
      if (fc && stop.highland && stop.start.slice(11, 13) <= "07") {
        const chance = cloudSeaChance(stop, fc);
        if (chance) alerts.push(cloudSeaAlert(day, stop, chance));
      }
    }
    alerts.push(...weatherAlerts(day, summaries), ...coldAlerts(day, summaries), ...airAlerts(day, summaries));
  }

  // Earthquakes: free, checked every run during the trip.
  if (tripDay) {
    try {
      alerts.push(...quakeAlerts(trip, await fetchQuakes(), now));
      note("quakes", true);
    } catch (err) {
      note("quakes", false, String(err));
    }
  }

  // Travel advisory: hourly. A change since the last check becomes an alert kept for 2 days.
  let advisoryAlerts = await store.json<TripAlert[]>("advisory:alerts", []);
  const advisoryBefore = advisoryAlerts;
  if (hourly) {
    try {
      const adv = await fetchAdvisory();
      const last = await env.TRIP_KV.get("advisory:last");
      if (last && last !== adv.updatedAt) advisoryAlerts = [advisoryAlert(adv, now), ...advisoryAlerts];
      if (last !== adv.updatedAt && !opts.dryRun) await env.TRIP_KV.put("advisory:last", adv.updatedAt);
      note("advisory", true);
    } catch (err) {
      note("advisory", false, String(err));
    }
  }
  advisoryAlerts = advisoryAlerts.filter((a) => a.date >= addDays(today, -1)).slice(0, 5);
  alerts.push(...advisoryAlerts);

  // News: hourly from a week before the trip. Only unseen headlines go to the AI model (two calls at
  // most, see claude.ts; the budget counts the run as one).
  let newsItems = await store.json<NewsItem[]>("news:items", []);
  const newsBefore = newsItems;
  let seen = await store.json<string[]>("news:seen", []);
  const seenBefore = seen;
  if (hourly && newsWindow && aiProvider(env) && !opts.dryRun) {
    try {
      const fresh = (await fetchGoogleNews(1)).filter((a) => !seen.includes(a.url)).slice(0, NEWS_BATCH);
      if (fresh.length && spend("claude")) {
        newsItems = [...(await triageNews(env, trip, today, fresh)), ...newsItems];
        seen = [...fresh.map((a) => a.url), ...seen].slice(0, 500);
      }
      note("news", true, `${fresh.length} כתבות חדשות`);
    } catch (err) {
      note("news", false, String(err));
    }
  }
  newsItems = newsItems.filter((n) => n.date >= today).slice(0, 30);
  alerts.push(...newsAlerts(newsItems, now));

  // Drive times: in the 3 hours before each planned departure today. The last reading of each
  // drive is kept for the rest of the day, so a closed road stays on screen after departure time.
  const roadBefore = await store.json<TripAlert[]>("road:alerts", []);
  let roadAlerts = roadBefore.filter((a) => a.date === today);
  if (env.GOOGLE_MAPS_KEY && !opts.dryRun) {
    for (const drive of trip.days.find((d) => d.date === today)?.drives ?? []) {
      const untilMin = (thLocal(drive.departAt).getTime() - now.getTime()) / MIN;
      const from = placeOf(trip, drive.fromId);
      const to = placeOf(trip, drive.toId);
      if (untilMin < 0 || untilMin > 180 || !from || !to || !spend("routes")) continue;
      try {
        const a = routeAlert(trip, drive, today, await fetchDriveTime(env.GOOGLE_MAPS_KEY, from, to, now), now);
        roadAlerts = [...roadAlerts.filter((x) => !x.id.startsWith(`road:${drive.id}:`)), ...(a ? [a] : [])];
        note("routes", true);
      } catch (err) {
        note("routes", false, String(err));
      }
    }
  }
  alerts.push(...roadAlerts);

  // Flights: hourly from 24 hours before departure, every 15 minutes in the last 6 hours.
  const flightsBefore = await store.json<FlightCache>("flights", { gates: {}, alerts: [] });
  const flights: FlightCache = { gates: { ...flightsBefore.gates }, alerts: [...flightsBefore.alerts] };
  if (env.RAPIDAPI_KEY && !opts.dryRun) {
    for (const f of trip.flights) {
      if (!f.number || !f.departLocal) continue;
      const hoursLeft = (localAt(f.departLocal, f.departUtcOffset).getTime() - now.getTime()) / 3_600_000;
      if (hoursLeft < -1 || hoursLeft > 24 || (hoursLeft > 6 && !hourly) || !spend("flights")) continue;
      try {
        const status = await fetchFlightStatus(env.RAPIDAPI_KEY, f);
        if (status) {
          // A gate change is reported once, when the gate moves; keep it until the next move.
          const fresh = flightAlerts(f, status, flights.gates[f.id], now);
          const gate = `flight:${f.id}:gate:`;
          const keepGate = !fresh.some((a) => a.id.startsWith(gate));
          flights.alerts = [
            ...flights.alerts.filter((a) => !a.id.startsWith(`flight:${f.id}:`) || (keepGate && a.id.startsWith(gate))),
            ...fresh,
          ];
          if (status.gate) flights.gates[f.id] = status.gate;
        }
        note("flights", true);
      } catch (err) {
        note("flights", false, String(err));
      }
    }
  }
  flights.alerts = flights.alerts.filter((a) => a.date >= addDays(today, -1));
  alerts.push(...flights.alerts, ...reminderAlerts(trip));

  const state: TripState = {
    generatedAt: now.toISOString(),
    alerts,
    dayStatus: dayStatuses(trip, alerts),
    forecasts: summaries,
    sources,
  };
  if (opts.dryRun) return state;

  // Pushes: each alert's scheduled times, plus the 20:00 briefing about tomorrow.
  const sentBefore = await store.json<string[]>("sent", []);
  const sent = new Set(sentBefore);
  const subs = await store.subs();
  const messages = duePushes(alerts, now, sent)
    .slice(0, 5)
    .map((p) => ({ key: p.key, msg: { title: p.alert.titleHe, body: p.alert.bodyHe, url: "/#alerts", tag: p.alert.id } }));
  const digest = hour === 20 && !sent.has(`digest:${today}`) ? eveningDigest(trip, alerts, summaries, now) : null;
  if (digest) messages.push({ key: `digest:${today}`, msg: { title: digest.title, body: digest.body, url: "/#today", tag: `digest:${today}` } });

  let liveSubs = subs;
  for (const m of messages) {
    if (liveSubs.length) {
      const { gone } = await sendToAll(env, liveSubs, m.msg);
      liveSubs = liveSubs.filter((s) => !gone.includes(s.endpoint));
    }
    sent.add(m.key);
  }
  if (liveSubs.length !== subs.length) await store.saveSubs(liveSubs);

  await store.putIfChanged("sent", [...sent].slice(-400), sentBefore);
  await store.putIfChanged(budgetKey, budget, budgetBefore);
  await store.putIfChanged("advisory:alerts", advisoryAlerts, advisoryBefore);
  await store.putIfChanged("news:items", newsItems, newsBefore);
  await store.putIfChanged("news:seen", seen, seenBefore);
  await store.putIfChanged("flights", flights, flightsBefore);
  await store.putIfChanged("road:alerts", roadAlerts, roadBefore);

  // The state changes every run (timestamps); save it when its content changed, or hourly.
  const previous = await store.state();
  const strip = (s: TripState | null) => s && { ...s, generatedAt: "", sources: {} };
  if (hourly || JSON.stringify(strip(previous)) !== JSON.stringify(strip(state))) {
    await env.TRIP_KV.put("state", JSON.stringify(state));
  }
  return state;
}
