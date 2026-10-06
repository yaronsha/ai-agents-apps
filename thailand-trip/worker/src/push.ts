import { buildPushHTTPRequest } from "@pushforge/builder";
import type { Env } from "./env";

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export type PushMessage = {
  title: string;
  body: string;
  /** Where tapping the notification opens the app, e.g. "/#alerts". */
  url?: string;
  tag?: string;
};

/** Sends to every subscription and returns the ones the push service says are gone. */
export async function sendToAll(env: Env, subs: PushSubscriptionJSON[], msg: PushMessage): Promise<{ sent: number; gone: string[] }> {
  const privateJWK = JSON.parse(env.VAPID_PRIVATE_JWK);
  let sent = 0;
  const gone: string[] = [];
  await Promise.all(
    subs.map(async (subscription) => {
      try {
        const { endpoint, headers, body } = await buildPushHTTPRequest({
          privateJWK,
          subscription,
          message: { payload: msg, adminContact: env.VAPID_CONTACT, options: { ttl: 6 * 3600, urgency: "high" } },
        });
        const res = await fetch(endpoint, { method: "POST", headers, body });
        if (res.status === 404 || res.status === 410) gone.push(subscription.endpoint);
        else if (res.ok) sent++;
        else console.warn("push failed", res.status, await res.text());
      } catch (err) {
        console.warn("push error", err);
      }
    }),
  );
  return { sent, gone };
}
