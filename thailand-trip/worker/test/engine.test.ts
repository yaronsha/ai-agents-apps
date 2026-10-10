import { afterEach, describe, expect, it, vi } from "vitest";
import { thLocal } from "@trip/shared";
import { runCheck } from "../src/engine";
import worker from "../src/index";
import { FakeKV, makeEnv, makeSubscription, stubFetch, type FetchLog } from "./fakes";

afterEach(() => vi.unstubAllGlobals());

describe("engine", () => {
  it("raises rain, cold, cloud-sea and quake alerts on a trip day and pushes the quake at once", async () => {
    const kv = new FakeKV();
    const env = await makeEnv(kv);
    await kv.put("subs", JSON.stringify([await makeSubscription()]));
    const log: FetchLog = { urls: [], pushes: 0 };
    vi.stubGlobal("fetch", stubFetch(log));

    const state = await runCheck(env, thLocal("2026-11-26T12:00"));
    const ids = state.alerts.map((a) => a.id);

    expect(ids).toContain("weather:pai-canyon:rain");
    expect(ids).toContain("cold:phu-chi-fa");
    expect(ids.some((id) => id.includes("twin-pagodas"))).toBe(false); // past days are not fetched
    expect(ids).toContain("clouds:phu-chi-fa:high");
    expect(ids).toContain("quake:us7");
    expect(state.dayStatus["2026-11-26"]).toBe("red");
    expect(state.forecasts["pai-canyon"].maxRainProb).toBe(85);
    expect(log.pushes).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(kv.data.get("sent")!)).toContain("quake:us7#0");
  });

  it("does not push the same alert twice on the next run", async () => {
    const kv = new FakeKV();
    const env = await makeEnv(kv);
    await kv.put("subs", JSON.stringify([await makeSubscription()]));
    const log: FetchLog = { urls: [], pushes: 0 };
    vi.stubGlobal("fetch", stubFetch(log));

    await runCheck(env, thLocal("2026-11-26T12:00"));
    const first = log.pushes;
    await runCheck(env, thLocal("2026-11-26T12:15"));
    expect(log.pushes).toBe(first);
  });

  it("keeps each source's last check when a later run skips it", async () => {
    const kv = new FakeKV();
    const env = await makeEnv(kv);
    vi.stubGlobal("fetch", stubFetch({ urls: [], pushes: 0 }));

    await runCheck(env, thLocal("2026-11-26T12:00"));
    const state = await runCheck(env, thLocal("2026-11-26T12:15"));
    expect(state.sources.advisory).toMatchObject({ ok: true, at: thLocal("2026-11-26T12:00").toISOString() });
    expect(state.sources.weather.at).toBe(thLocal("2026-11-26T12:00").toISOString());
    expect(state.sources.quakes.at).toBe(thLocal("2026-11-26T12:15").toISOString());
  });

  it("sends the 20:00 briefing once", async () => {
    const kv = new FakeKV();
    const env = await makeEnv(kv);
    await kv.put("subs", JSON.stringify([await makeSubscription()]));
    const log: FetchLog = { urls: [], pushes: 0 };
    vi.stubGlobal("fetch", stubFetch(log, "2099-01-01"));

    await runCheck(env, thLocal("2026-11-25T20:00"));
    const after = log.pushes;
    await runCheck(env, thLocal("2026-11-25T20:15"));
    expect(after).toBeGreaterThanOrEqual(1);
    expect(log.pushes).toBe(after);
    expect(JSON.parse(kv.data.get("sent")!)).toContain("digest:2026-11-25");
  });

  it("skips paid sources without keys and stays within the KV write budget", async () => {
    const kv = new FakeKV();
    const env = await makeEnv(kv);
    const log: FetchLog = { urls: [], pushes: 0 };
    vi.stubGlobal("fetch", stubFetch(log, "2099-01-01"));

    for (let m = 0; m < 24 * 60; m += 15) {
      const t = new Date(thLocal("2026-11-27T00:00").getTime() + m * 60_000);
      await runCheck(env, t);
    }
    expect(log.urls.some((u) => u.includes("googleapis") || u.includes("rapidapi") || u.includes("gdelt"))).toBe(false);
    expect(kv.writes).toBeLessThan(1000);
  });

  it("previews another moment without saving, pushing or calling paid sources", async () => {
    const kv = new FakeKV();
    const env = { ...(await makeEnv(kv)), ANTHROPIC_API_KEY: "k", GOOGLE_MAPS_KEY: "k", RAPIDAPI_KEY: "k" };
    const log: FetchLog = { urls: [], pushes: 0 };
    vi.stubGlobal("fetch", stubFetch(log));
    await runCheck(env, thLocal("2026-11-26T08:00"), { dryRun: true });
    expect(kv.writes).toBe(0);
    expect(log.urls.some((u) => u.includes("googleapis") || u.includes("rapidapi") || u.includes("anthropic") || u.includes("gdelt"))).toBe(false);
  });
});

describe("http api", () => {
  it("rejects pushes, state and private trip data without the access code", async () => {
    const env = await makeEnv(new FakeKV());
    const res = await worker.fetch(new Request("https://w/api/test-push", { method: "POST" }), env);
    expect(res.status).toBe(401);
    expect((await worker.fetch(new Request("https://w/api/state"), env)).status).toBe(401);
    expect((await worker.fetch(new Request("https://w/api/trip-private"), env)).status).toBe(401);
  });

  it("says which paid sources have a key, without the keys", async () => {
    const env = { ...(await makeEnv(new FakeKV())), GOOGLE_MAPS_KEY: "k" };
    const body = await (await worker.fetch(new Request("https://w/api/config"), env)).text();
    expect(JSON.parse(body).configured).toMatchObject({ routes: true, flights: false });
    expect(body).not.toContain('"k"');
  });

  it("serves hotels and flights only with the access code", async () => {
    const env = await makeEnv(new FakeKV());
    const res = await worker.fetch(new Request("https://w/api/trip-private", { headers: { "X-Trip-Token": "secret" } }), env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { lodgings: unknown[] }).lodgings.length).toBeGreaterThan(0);
  });

  it("stores a push subscription once per device", async () => {
    const kv = new FakeKV();
    const env = await makeEnv(kv);
    const sub = await makeSubscription();
    const req = () => new Request("https://w/api/subscribe", { method: "POST", headers: { "X-Trip-Token": "secret" }, body: JSON.stringify(sub) });
    await worker.fetch(req(), env);
    const res = await worker.fetch(req(), env);
    expect(((await res.json()) as { devices: number }).devices).toBe(1);
  });
});
