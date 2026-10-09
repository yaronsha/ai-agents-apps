import { trip, tripPrivateData } from "@trip/shared/private";
import type { Env } from "./env";
import { runCheck } from "./engine";
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

// With Cloudflare Access set up, only a signed-in allowed email gets through and the old
// access code no longer opens anything. Until then the access code is the only lock.
async function authorized(req: Request, env: Env): Promise<boolean> {
  if (accessEnabled(env)) return (await accessEmail(req, env)) !== null;
  return Boolean(env.APP_TOKEN) && req.headers.get("X-Trip-Token") === env.APP_TOKEN;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    const store = new Store(env.TRIP_KV);

    if (req.method === "GET" && url.pathname === "/api/config") {
      return json({ vapidPublicKey: env.VAPID_PUBLIC_KEY, ai: aiProvider(env), auth: accessEnabled(env) ? "access" : "token" });
    }

    // Everything else (state included: alerts can name hotels) needs sign-in or the access code.
    if (!url.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
    if (!(await authorized(req, env))) return json({ error: accessEnabled(env) ? "צריך להתחבר מחדש" : "קוד גישה שגוי" }, 401);

    if (req.method === "GET" && url.pathname === "/api/state") {
      // Before the first cron run there is no saved state; a dry run uses only the free sources.
      return json((await store.state()) ?? (await runCheck(env, new Date(), { dryRun: true })));
    }
    if (req.method === "GET" && url.pathname === "/api/trip-private") {
      return json(tripPrivateData);
    }
    if (req.method !== "POST") return json({ error: "not found" }, 404);

    switch (url.pathname) {
      case "/api/subscribe": {
        const sub = (await req.json()) as PushSubscriptionJSON;
        if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return json({ error: "bad subscription" }, 400);
        const subs = (await store.subs()).filter((s) => s.endpoint !== sub.endpoint);
        await store.saveSubs([...subs, sub]);
        return json({ ok: true, devices: subs.length + 1 });
      }
      case "/api/unsubscribe": {
        const { endpoint } = (await req.json()) as { endpoint: string };
        await store.saveSubs((await store.subs()).filter((s) => s.endpoint !== endpoint));
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
        const at = url.searchParams.get("at");
        const now = at ? new Date(`${at}:00+07:00`) : new Date();
        return json(await runCheck(env, now, { dryRun: Boolean(at) }));
      }
      case "/api/replan": {
        if (!aiProvider(env)) return json({ error: env.AI_PROVIDER?.toLowerCase() === "openai" ? "אין מפתח OpenAI בשרת" : "אין מפתח Claude בשרת" }, 400);
        const { date, problem } = (await req.json()) as { date: string; problem?: string };
        if (!trip.days.some((d) => d.date === date)) return json({ error: "תאריך לא בטיול" }, 400);
        const state = await store.state();
        try {
          return json({ text: await replan(env, trip, date, state?.alerts ?? [], problem ?? "") });
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
    await runCheck(env, new Date(event.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
