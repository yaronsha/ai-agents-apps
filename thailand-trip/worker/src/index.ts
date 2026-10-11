import { trip, tripPrivateData } from "@trip/shared/private";
import type { Env } from "./env";
import { thDate, thLocal } from "@trip/shared";
import { DAILY_CAPS, replanBudgetKey, runCheck } from "./engine";
import { runShadow, shadowLog } from "./shadow";
import { Store } from "./store";
import { sendToAll, type PushSubscriptionJSON } from "./push";
import { aiProvider, replan } from "./ai";
import { accessEmail, accessEnabled } from "./access";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Trip-Token",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS } });

/** The request body as a JSON object, or null when it isn't one (the route answers 400, not 500). */
async function readJson<T>(req: Request): Promise<Partial<T> | null> {
  try {
    const body: unknown = await req.json();
    return body && typeof body === "object" ? (body as Partial<T>) : null;
  } catch {
    return null;
  }
}
const badBody = () => json({ error: "גוף הבקשה אינו JSON תקין" }, 400);

/** A preview moment in Thai time, exactly like 2026-11-26T12:00; null for anything else. */
export function parsePreviewAt(at: string | null): Date | null {
  if (!at || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at)) return null;
  const date = thLocal(at);
  // Rejects impossible moments such as 2026-02-30T10:00, which Date would roll over to March.
  return Number.isNaN(date.getTime()) || new Date(date.getTime() + 7 * 3600_000).toISOString().slice(0, 16) !== at ? null : date;
}

const hasToken = (req: Request, env: Env) => Boolean(env.APP_TOKEN) && req.headers.get("X-Trip-Token") === env.APP_TOKEN;

// With Cloudflare Access set up, only a signed-in allowed email gets through and the old
// access code opens nothing but the news shadow log, which `npm run shadow:report` reads from
// a terminal and which holds only public headlines. Until then the access code is the only lock.
async function authorized(req: Request, env: Env, path: string): Promise<boolean> {
  if (!accessEnabled(env)) return hasToken(req, env);
  if (path === "/api/shadow" && hasToken(req, env)) return true;
  return (await accessEmail(req, env)) !== null;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    const store = new Store(env.TRIP_KV);

    if (req.method === "GET" && url.pathname === "/api/config") {
      // Which paid sources have a key, so the app can say a source is off instead of promising a check.
      const configured = { news: Boolean(aiProvider(env)), routes: Boolean(env.GOOGLE_MAPS_KEY), flights: Boolean(env.RAPIDAPI_KEY) };
      return json({ vapidPublicKey: env.VAPID_PUBLIC_KEY, ai: aiProvider(env), auth: accessEnabled(env) ? "access" : "token", configured });
    }

    // Everything else (state included: alerts can name hotels) needs sign-in or the access code.
    if (!url.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
    if (!(await authorized(req, env, url.pathname))) return json({ error: accessEnabled(env) ? "צריך להתחבר מחדש" : "קוד גישה שגוי" }, 401);

    if (req.method === "GET" && url.pathname === "/api/state") {
      // Before the first cron run there is no saved state; a dry run uses only the free sources.
      return json((await store.state()) ?? (await runCheck(env, new Date(), { dryRun: true })));
    }
    if (req.method === "GET" && url.pathname === "/api/trip-private") {
      return json(tripPrivateData);
    }
    if (req.method === "GET" && url.pathname === "/api/shadow") {
      const days = Math.min(45, Math.max(1, Number(url.searchParams.get("days")) || 21));
      return json(await shadowLog(env, new Date(), days));
    }
    if (req.method !== "POST") return json({ error: "not found" }, 404);

    switch (url.pathname) {
      case "/api/subscribe": {
        const sub = await readJson<PushSubscriptionJSON>(req);
        if (!sub) return badBody();
        if (typeof sub.endpoint !== "string" || !sub.endpoint.startsWith("https://") || typeof sub.keys?.p256dh !== "string" || typeof sub.keys?.auth !== "string")
          return json({ error: "bad subscription" }, 400);
        await store.addSub(sub as PushSubscriptionJSON);
        // KV list is eventually consistent, so the key just written may not be listed yet.
        const devices = new Set([...(await store.subs()).map((s) => s.endpoint), sub.endpoint]).size;
        return json({ ok: true, devices });
      }
      case "/api/unsubscribe": {
        const body = await readJson<{ endpoint: string }>(req);
        if (!body) return badBody();
        if (typeof body.endpoint !== "string") return json({ error: "bad subscription" }, 400);
        await store.removeSubs([body.endpoint]);
        return json({ ok: true });
      }
      case "/api/test-push": {
        const result = await sendToAll(env, await store.subs(), {
          title: "בדיקה: סופה צפויה בקניון פאי",
          body: "כך תיראה התראה אמיתית. לחיצה פותחת את מסך הבלת\"מים.",
          url: "/#alerts",
          tag: "test",
        });
        return json(result);
      }
      case "/api/run": {
        // ?at=2026-11-26T12:00 previews the engine at another moment, without pushing or saving.
        // Only previews: a real check spends paid budget and sends pushes, and that is the cron's job.
        const now = parsePreviewAt(url.searchParams.get("at"));
        if (!now) return json({ error: "צריך רגע לתצוגה מקדימה בפורמט 2026-11-26T12:00" }, 400);
        return json(await runCheck(env, now, { dryRun: true }));
      }
      case "/api/replan": {
        if (!aiProvider(env)) return json({ error: env.AI_PROVIDER?.toLowerCase() === "openai" ? "אין מפתח OpenAI בשרת" : "אין מפתח Claude בשרת" }, 400);
        const body = await readJson<{ date: string; problem: string }>(req);
        if (!body) return badBody();
        const { date, problem } = body;
        if (!trip.days.some((d) => d.date === date)) return json({ error: "תאריך לא בטיול" }, 400);
        if (problem != null && typeof problem !== "string") return json({ error: "תיאור הבעיה אינו טקסט" }, 400);
        if (problem && problem.length > 2000) return json({ error: "תיאור הבעיה ארוך מדי" }, 400);
        // Every tap is a large model call, so it counts against a daily cap even when the call fails.
        const budgetKey = replanBudgetKey(thDate(new Date()));
        const used = await store.json<number>(budgetKey, 0);
        if (used >= DAILY_CAPS.replan) return json({ error: `הגעתם למכסה היומית של ${DAILY_CAPS.replan} תכנונים מחדש. אפשר שוב מחר` }, 429);
        await env.TRIP_KV.put(budgetKey, JSON.stringify(used + 1), { expirationTtl: 3 * 86400 });
        const state = await store.state();
        try {
          return json({ text: await replan(env, trip, date as string, state?.alerts ?? [], problem ?? "") });
        } catch (err) {
          // e.g. out of credits (429) or an outage: say so in the app rather than a bare network error.
          const status = (err as { status?: number }).status;
          return json({ error: status === 429 ? "נגמרה המכסה או הקרדיט אצל ספק ה־AI" : `שגיאה מספק ה־AI: ${(err as Error).message}` }, 502);
        }
      }
    }
    return json({ error: "not found" }, 404);
  },

  // The cron's own time rather than the clock: the same in production, and lets the simulator
  // (sim/) play a whole trip day through the real handler in seconds.
  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    const now = new Date(event.scheduledTime);
    const state = await runCheck(env, now);
    // News shadow mode only logs; whatever goes wrong there must not fail the real check.
    try {
      await runShadow(env, now, { gdeltCalled: "news" in state.sources });
    } catch (err) {
      console.error("shadow", err);
    }
  },
} satisfies ExportedHandler<Env>;
