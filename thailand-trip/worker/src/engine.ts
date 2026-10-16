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
  placeAlerts,
  placeNoticeAlerts,
  placeOf,
  quakeAlerts,
  reminderAlerts,
  RULES,
  routeAlert,
  summarizeStop,
  thDate,
  thLocal,
  thParts,
  weatherAlerts,
  type HourlyAir,
  type HourlyForecast,
  type NewsItem,
  type PlaceNotice,
  type StopForecast,
  type TripAlert,
  type TripState,
} from "@trip/shared";
import { trip } from "@trip/shared/private";
import type { Env } from "./env";
import { Store } from "./store";
import { sendToAll, vapidKey } from "./push";
import { fetchAir, fetchForecasts } from "./sources/openmeteo";
import { fetchQuakes } from "./sources/usgs";
import { fetchAdvisory } from "./sources/fcdo";
import { fetchArticles } from "./sources/gdelt";
import { fetchDriveTime } from "./sources/routes";
import { fetchFlightStatus } from "./sources/flights";
import { aiProvider, checkPlaces, translateAdvisory, triageNews } from "./ai";
import { placeCheckDates, placeTargets, PLACES_PER_CALL } from "./places";

const MIN = 60_000;

/** Daily caps on paid calls, so a bug can never run up a bill. */
export const DAILY_CAPS = { routes: 100, flights: 60, claude: 60, places: 8, replan: 20 } as const;
// Re-plan is counted by its route under its own key (`replanBudgetKey`), so a cron run saving
// this day's budget can't overwrite a tap made meanwhile.
type Budget = Record<Exclude<keyof typeof DAILY_CAPS, "replan">, number>;
export const replanBudgetKey = (date: string) => `budget:replan:${date}`;

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

/**
 * Two runs at once (a cron tick fired twice, or POST /api/run during the cron) would both read
 * "sent" before either saves it and push the same alert twice. Each run leaves its start time
 * here; a run starting within 10 minutes of another one returns the saved state instead.
 * The time is the run's own (the cron's scheduled time), so the simulator's fast-forwarded
 * ticks don't block each other. KV is eventually consistent, so this is a best effort, and it
 * costs one write a run instead of two because the key expires on its own.
 */
export const RUN_LOCK = { key: "run:lock", ms: 10 * MIN } as const;

export async function runCheck(env: Env, now: Date, opts: RunOptions = {}): Promise<TripState> {
  const store = new Store(env.TRIP_KV);
  if (!opts.dryRun) {
    const other = Number(await env.TRIP_KV.get(RUN_LOCK.key));
    if (other && Math.abs(now.getTime() - other) < RUN_LOCK.ms) {
      console.warn("another check started at", new Date(other).toISOString(), "- skipping this one");
      return (await store.state()) ?? runCheck(env, now, { dryRun: true });
    }
    await env.TRIP_KV.put(RUN_LOCK.key, String(now.getTime()), { expirationTtl: RUN_LOCK.ms / 1000 });
  }
  const today = thDate(now);
  const { hour, minute } = thParts(now);
  const hourly = minute < 15 || opts.dryRun;
  // Each source keeps its last check from earlier runs, since most sources are not checked every run.
  // A preview starts empty, so it shows only what it checked at the previewed moment.
  const previous = await store.state();
  const sources: TripState["sources"] = opts.dryRun ? {} : { ...previous?.sources };
  const note = (name: string, ok: boolean, msg?: string) => (sources[name] = { ok, at: now.toISOString(), note: msg });
  const tripDay = trip.days.some((d) => d.date === today);
  const newsWindow = today >= addDays(trip.startDate, -7) && today <= trip.endDate;

  const budgetKey = `budget:${today}`;
  // Spread over zeros, so a counter added later still starts at zero on a day that has a saved budget.
  const budgetBefore: Budget = { routes: 0, flights: 0, claude: 0, places: 0, ...(await store.json<Partial<Budget>>(budgetKey, {})) };
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
      if (last && last !== adv.updatedAt) {
        // The change note is English; translate it when an AI model is set, or show it as is.
        let he: string | undefined;
        if (aiProvider(env) && !opts.dryRun && spend("claude")) {
          try {
            he = await translateAdvisory(env, adv.description);
          } catch (err) {
            console.error("advisory translation", err);
          }
        }
        advisoryAlerts = [advisoryAlert(adv, now, he), ...advisoryAlerts];
      }
      if (last !== adv.updatedAt && !opts.dryRun) await env.TRIP_KV.put("advisory:last", adv.updatedAt);
      note("advisory", true);
    } catch (err) {
      note("advisory", false, String(err));
    }
  }
  advisoryAlerts = advisoryAlerts.filter((a) => a.date >= addDays(today, -1)).slice(0, 5);
  alerts.push(...advisoryAlerts);

  // News: hourly from a week before the trip. Only unseen headlines go to the AI model.
  let newsItems = await store.json<NewsItem[]>("news:items", []);
  const newsBefore = newsItems;
  let seen = await store.json<string[]>("news:seen", []);
  const seenBefore = seen;
  if (hourly && newsWindow && aiProvider(env) && !opts.dryRun) {
    try {
      const fresh = (await fetchArticles()).filter((a) => !seen.includes(a.url)).slice(0, 25);
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
          // A gate change is reported once, when the gate moves; keep it until the next move, or
          // until the flight is cancelled, when the old gate is noise next to the cancellation.
          const fresh = flightAlerts(f, status, flights.gates[f.id], now);
          const gate = `flight:${f.id}:gate:`;
          const keepGate = !fresh.some((a) => a.id.startsWith(gate) || a.id === `flight:${f.id}:cancel`);
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

  // Places on the plan: what the bundled facts already say, plus what the web check found. The check
  // runs last because web searches are slow. Each stop it looks at gets fresh findings, so a place
  // that reopened loses its old alert.
  alerts.push(...placeAlerts(trip));
  const placesBefore = await store.json<PlaceNotice[]>("places:items", []);
  let placeItems = placesBefore.filter((n) => n.date >= today);
  const placeDates = opts.dryRun || !aiProvider(env) ? [] : placeCheckDates(trip, now);
  if (placeDates.length) {
    const targets = placeTargets(trip, placeDates);
    let checked = 0;
    let failed: string | undefined;
    for (let i = 0; i < targets.length; i += PLACES_PER_CALL) {
      const batch = targets.slice(i, i + PLACES_PER_CALL);
      if (!spend("places")) break;
      try {
        const found = await checkPlaces(env, today, batch);
        const done = (n: PlaceNotice) => batch.some((t) => t.stopId === n.stopId && t.date === n.date);
        placeItems = [...placeItems.filter((n) => !done(n)), ...found];
        checked += batch.length;
      } catch (err) {
        failed = String(err);
      }
    }
    note("places", !failed, failed ?? `${checked} עצירות נבדקו`);
  }
  alerts.push(...placeNoticeAlerts(placeItems, now));

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

  // A push is marked sent once a device got it, or when no device is left to get it. One that
  // failed for every device (an outage at Apple or Google) is tried again on the next run, until
  // RULES.staleHours drops it. A bad VAPID key fails them all here instead of throwing, so the
  // rest of the run is still saved and the failure shows as the "push" source.
  let liveSubs = subs;
  let unsent = 0;
  let pushError: string | undefined;
  if (messages.length && subs.length) {
    try {
      const jwk = vapidKey(env);
      for (const m of messages) {
        const res = liveSubs.length ? await sendToAll(env, liveSubs, m.msg, jwk) : { sent: 0, gone: [], failed: 0 };
        liveSubs = liveSubs.filter((s) => !res.gone.includes(s.endpoint));
        if (res.sent > 0 || res.failed === 0) sent.add(m.key);
        else unsent++;
      }
    } catch (err) {
      pushError = String(err);
      unsent = messages.length;
    }
    const why = unsent === 1 ? "התראה אחת לא נשלחה" : `${unsent} התראות לא נשלחו`;
    note("push", !unsent, pushError ?? (unsent ? `${why}, ננסה שוב בריצה הבאה` : undefined));
  } else {
    for (const m of messages) sent.add(m.key);
    // Pushes that failed are retried only for RULES.staleHours; after that nothing is pending,
    // so a red row would point at a retry that will never happen.
    const last = sources.push;
    if (last && !last.ok && now.getTime() - Date.parse(last.at) > RULES.staleHours * 3_600_000) {
      note("push", true, "התראות שלא נשלחו קודם כבר לא רלוונטיות");
    }
  }
  await store.removeSubs(subs.filter((s) => !liveSubs.includes(s)).map((s) => s.endpoint));

  await store.putIfChanged("sent", [...sent].slice(-400), sentBefore);
  await store.putIfChanged(budgetKey, budget, budgetBefore);
  await store.putIfChanged("advisory:alerts", advisoryAlerts, advisoryBefore);
  await store.putIfChanged("news:items", newsItems, newsBefore);
  await store.putIfChanged("news:seen", seen, seenBefore);
  await store.putIfChanged("flights", flights, flightsBefore);
  await store.putIfChanged("road:alerts", roadAlerts, roadBefore);
  await store.putIfChanged("places:items", placeItems, placesBefore);

  // The state changes every run (timestamps); save it when its content changed, or hourly.
  // A source that starts or stops failing counts as a change; a fresh check time alone does not.
  const strip = (s: TripState | null) =>
    s && { ...s, generatedAt: "", sources: Object.entries(s.sources).map(([k, v]) => [k, v.ok, v.note]) };
  if (hourly || JSON.stringify(strip(previous)) !== JSON.stringify(strip(state))) {
    await env.TRIP_KV.put("state", JSON.stringify(state));
  }
  return state;
}
