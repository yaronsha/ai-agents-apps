import { afterEach, describe, expect, it, vi } from "vitest";
import { thLocal } from "@trip/shared";
import { runCheck } from "../src/engine";
import { fetchWithTimeout } from "../src/sources/http";
import worker from "../src/index";
import { FakeKV, makeEnv, makeSubscription, stubFetch, type FetchLog } from "./fakes";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** The usual stub, with the push service answering `pushStatus` and every other request logged. */
function withPushStatus(log: FetchLog, pushStatus: () => number, other: string[] = []) {
  const base = stubFetch(log);
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST" && new URL(url).host === "push.example") {
      log.urls.push(url);
      log.pushes++;
      return new Response(null, { status: pushStatus() });
    }
    if (new URL(url).host === "hc-ping.com") {
      other.push(`${url} ${init?.body ?? ""}`);
      return new Response("OK");
    }
    return base(input, init);
  };
}

describe("cron reliability", () => {
  it("gives up on a hung request instead of waiting for it", async () => {
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason))));
    await expect(fetchWithTimeout("https://slow.example", {}, 20)).rejects.toThrow(/timed? ?out/i);
  });

  it("tries a push again when the push service failed, and marks it sent once it gets through", async () => {
    const kv = new FakeKV();
    const env = await makeEnv(kv);
    await kv.put("subs", JSON.stringify([await makeSubscription()]));
    let status = 503;
    const log: FetchLog = { urls: [], pushes: 0 };
    vi.stubGlobal("fetch", withPushStatus(log, () => status));

    const first = await runCheck(env, thLocal("2026-11-26T12:00"));
    expect(JSON.parse(kv.data.get("sent") ?? "[]")).not.toContain("quake:us7#0");
    expect(first.sources.push).toMatchObject({ ok: false });
    expect(JSON.parse(kv.data.get("subs")!)).toHaveLength(1);

    status = 201;
    const tries = log.pushes;
    const second = await runCheck(env, thLocal("2026-11-26T12:15"));
    expect(log.pushes).toBeGreaterThan(tries);
    expect(JSON.parse(kv.data.get("sent")!)).toContain("quake:us7#0");
    expect(second.sources.push).toMatchObject({ ok: true });
  });

  it("still saves the run when the VAPID key is broken, and shows it as the push source", async () => {
    const kv = new FakeKV();
    const env = { ...(await makeEnv(kv)), VAPID_PRIVATE_JWK: "not json" };
    await kv.put("subs", JSON.stringify([await makeSubscription()]));
    vi.stubGlobal("fetch", stubFetch({ urls: [], pushes: 0 }));

    await runCheck(env, thLocal("2026-11-26T12:00"));
    const saved = JSON.parse(kv.data.get("state")!);
    expect(saved.sources.push).toMatchObject({ ok: false, note: expect.stringContaining("VAPID_PRIVATE_JWK") });
    expect(JSON.parse(kv.data.get("sent") ?? "[]")).not.toContain("quake:us7#0");
  });

  it("skips a second run that starts within 10 minutes of another", async () => {
    const kv = new FakeKV();
    const env = await makeEnv(kv);
    await kv.put("subs", JSON.stringify([await makeSubscription()]));
    const log: FetchLog = { urls: [], pushes: 0 };
    vi.stubGlobal("fetch", stubFetch(log));

    // e.g. the same cron tick delivered twice, or POST /api/run during the cron.
    await runCheck(env, thLocal("2026-11-26T12:00"));
    const again = await runCheck(env, thLocal("2026-11-26T12:05"));
    expect(again.generatedAt).toBe(thLocal("2026-11-26T12:00").toISOString());
    const once = log.urls.filter((u) => u.includes("usgs")).length;
    expect(once).toBe(1);
    expect(log.pushes).toBe(1);
    // The next tick is 15 minutes later and runs as usual.
    await runCheck(env, thLocal("2026-11-26T12:15"));
    expect(log.urls.filter((u) => u.includes("usgs")).length).toBe(2);
  });

  it("pings the heartbeat after each cron run, and says fail when the run throws", async () => {
    const kv = new FakeKV();
    const env = { ...(await makeEnv(kv)), HEARTBEAT_URL: "https://hc-ping.com/abc", SHADOW_NEWS: "off" };
    const pings: string[] = [];
    vi.stubGlobal("fetch", withPushStatus({ urls: [], pushes: 0 }, () => 201, pings));
    const tick = (at: string) => worker.scheduled({ scheduledTime: thLocal(at).getTime() } as ScheduledController, env);

    await tick("2026-11-26T12:00");
    expect(pings).toEqual(["https://hc-ping.com/abc ok"]);

    kv.get = async () => {
      throw new Error("KV quota exceeded");
    };
    await expect(tick("2026-11-26T12:15")).rejects.toThrow("KV quota");
    expect(pings[1]).toMatch(/^https:\/\/hc-ping.com\/abc\/fail check failed: .*KV quota/);
  });
});
