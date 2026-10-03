import { trip, tripPrivateData } from "@trip/shared/private";
import type { Env } from "./env";
import { runCheck } from "./engine";
import { Store } from "./store";
import { sendToAll, type PushSubscriptionJSON } from "./push";
import { replan } from "./claude";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Trip-Token",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS } });

function authorized(req: Request, env: Env): boolean {
  return Boolean(env.APP_TOKEN) && req.headers.get("X-Trip-Token") === env.APP_TOKEN;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    const store = new Store(env.TRIP_KV);

    if (req.method === "GET" && url.pathname === "/api/config") {
      return json({ vapidPublicKey: env.VAPID_PUBLIC_KEY, claude: Boolean(env.ANTHROPIC_API_KEY) });
    }

    // Everything else (state included: alerts can name hotels) needs the access code.
    if (!url.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
    if (!authorized(req, env)) return json({ error: "קוד גישה שגוי" }, 401);

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
        if (!env.ANTHROPIC_API_KEY) return json({ error: "אין מפתח Claude בשרת" }, 400);
        const { date, problem } = (await req.json()) as { date: string; problem?: string };
        if (!trip.days.some((d) => d.date === date)) return json({ error: "תאריך לא בטיול" }, 400);
        const state = await store.state();
        return json({ text: await replan(env, trip, date, state?.alerts ?? [], problem ?? "") });
      }
    }
    return json({ error: "not found" }, 404);
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCheck(env, new Date()).then(() => undefined));
  },
} satisfies ExportedHandler<Env>;
