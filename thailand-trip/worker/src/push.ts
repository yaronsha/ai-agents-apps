import { buildPushHTTPRequest } from "@pushforge/builder";
import type { Env } from "./env";
import { fetchWithTimeout } from "./sources/http";

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

/** The VAPID signing key, with a clear error when the secret is missing or not the JSON from `npm run vapid`. */
export function vapidKey(env: Env): JsonWebKey {
  try {
    const jwk = JSON.parse(env.VAPID_PRIVATE_JWK) as JsonWebKey;
    if (jwk?.kty === "EC" && jwk.d) return jwk;
  } catch {
    // reported below
  }
  throw new Error("VAPID_PRIVATE_JWK is missing or is not the private key JSON from npm run vapid");
}

export interface PushResult {
  /** Devices that accepted the push. */
  sent: number;
  /** Endpoints the push service says are gone (404, 410): drop them. */
  gone: string[];
  /** Devices that may still be there but did not get it (5xx, 429, network error, timeout): try again later. */
  failed: number;
}

/** Sends to every subscription and says which got it, which are gone and how many failed for now. */
export async function sendToAll(env: Env, subs: PushSubscriptionJSON[], msg: PushMessage, privateJWK = vapidKey(env)): Promise<PushResult> {
  let sent = 0;
  let failed = 0;
  const gone: string[] = [];
  await Promise.all(
    subs.map(async (subscription) => {
      try {
        const { endpoint, headers, body } = await buildPushHTTPRequest({
          privateJWK,
          subscription,
          message: { payload: msg, adminContact: env.VAPID_CONTACT, options: { ttl: 6 * 3600, urgency: "high" } },
        });
        const res = await fetchWithTimeout(endpoint, { method: "POST", headers, body });
        if (res.status === 404 || res.status === 410) gone.push(subscription.endpoint);
        else if (res.ok) sent++;
        else {
          failed++;
          console.warn("push failed", res.status, await res.text());
        }
      } catch (err) {
        failed++;
        console.warn("push error", err);
      }
    }),
  );
  return { sent, gone, failed };
}
