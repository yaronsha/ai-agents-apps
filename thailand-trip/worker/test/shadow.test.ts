import { afterEach, describe, expect, it, vi } from "vitest";
import { thLocal } from "@trip/shared";
import { runShadow, shadowKey, type ShadowRecord } from "../src/shadow";
import worker from "../src/index";
import { triageNews } from "../src/ai";
import { FakeKV, makeEnv, stubFetch, type FetchLog } from "./fakes";

vi.mock("../src/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/ai")>()),
  triageNews: vi.fn(async (_env: unknown, _trip: unknown, today: string, articles: Array<{ url: string }>) =>
    articles.slice(0, 1).map((a) => ({ url: a.url, date: today, severity: "warning", titleHe: "x", bodyHe: "y" })),
  ),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(triageNews).mockClear();
});

const rss = `<?xml version="1.0"?><rss><channel>
<item><title>Flood closes road in Pai - Bangkok Post</title><link>https://news.google.com/a1</link><pubDate>Sat, 10 Oct 2026 01:00:00 GMT</pubDate><source url="https://www.bangkokpost.com">Bangkok Post</source></item>
<item><title>Haze returns to Chiang Mai - Nation</title><link>https://news.google.com/a2</link><pubDate>Fri, 09 Oct 2026 20:00:00 GMT</pubDate><source url="https://www.nationthailand.com">Nation</source></item>
<item><title>Border market reopens - Nation</title><link>https://news.google.com/a3</link><pubDate>Fri, 09 Oct 2026 18:00:00 GMT</pubDate><source url="https://www.nationthailand.com">Nation</source></item>
</channel></rss>`;

/** The engine's stubs plus both news sources; `failGoogle` makes Google News answer 503. */
function newsFetch(log: FetchLog, failGoogle = false) {
  const base = stubFetch(log, "2099-01-01");
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    const u = new URL(url);
    if (u.host === "news.google.com") {
      log.urls.push(url);
      return failGoogle ? new Response("busy", { status: 503 }) : new Response(rss, { headers: { "Content-Type": "application/rss+xml" } });
    }
    if (u.host === "api.gdeltproject.org") {
      log.urls.push(url);
      const articles = u.searchParams.get("timespan") === "3d" ? [{ url: "https://g/1", title: "Landslide near Mae Hong Son", domain: "example.com", seendate: "20261008T030000Z" }] : [];
      return new Response(JSON.stringify({ articles }), { headers: { "Content-Type": "application/json" } });
    }
    return base(input, init);
  };
}

const at = (local: string) => thLocal(local);

describe("news shadow mode", () => {
  it("runs only on the hourly run, with one KV write of the expected shape", async () => {
    const kv = new FakeKV();
    const env = await makeEnv(kv);
    const log: FetchLog = { urls: [], pushes: 0 };
    vi.stubGlobal("fetch", newsFetch(log));

    expect(await runShadow(env, at("2026-10-10T09:15"), { gapMs: 0 })).toBeNull();
    expect(kv.writes).toBe(0);
    expect(log.urls).toHaveLength(0);

    await runShadow(env, at("2026-10-10T09:00"), { gapMs: 0 });
    expect(kv.writes).toBe(1);
    expect(kv.options.get(shadowKey("2026-10-10"))).toEqual({ expirationTtl: 45 * 24 * 3600 });
    const [rec] = JSON.parse(kv.data.get(shadowKey("2026-10-10"))!) as ShadowRecord[];
    expect(rec.hour).toBe(9);
    expect(Object.keys(rec.sources)).toEqual(["google-1d", "gdelt-24h", "gdelt-3d"]);
    const google = rec.sources["google-1d"];
    expect(google).toMatchObject({ ok: true, count: 3, newestAgeMin: 60, routeMentions: 2 });
    expect(google.titles[0]).toEqual({ title: "Flood closes road in Pai", domain: "bangkokpost.com", date: "2026-10-10T01:00" });
    expect(rec.sources["gdelt-24h"]).toMatchObject({ ok: true, count: 0, newestAgeMin: null });
    expect(rec.sources["gdelt-3d"]).toMatchObject({ ok: true, count: 1, routeMentions: 1, newestAgeMin: 47 * 60 });
    expect(rec.ai).toBeUndefined();

    await runShadow(env, at("2026-10-10T10:00"), { gapMs: 0 });
    expect(kv.writes).toBe(2);
    expect(JSON.parse(kv.data.get(shadowKey("2026-10-10"))!)).toHaveLength(2);
  });

  it("records a failing source as an error while the others succeed", async () => {
    const kv = new FakeKV();
    const env = await makeEnv(kv);
    vi.stubGlobal("fetch", newsFetch({ urls: [], pushes: 0 }, true));
    const rec = (await runShadow(env, at("2026-10-10T09:00"), { gapMs: 0 }))!;
    expect(rec.sources["google-1d"]).toMatchObject({ ok: false, count: 0 });
    expect(rec.sources["google-1d"].error).toContain("503");
    expect(rec.sources["gdelt-3d"]).toMatchObject({ ok: true, count: 1 });
    expect(kv.writes).toBe(1);
  });

  it("does nothing when SHADOW_NEWS is off, also through the cron handler", async () => {
    const kv = new FakeKV();
    const env = { ...(await makeEnv(kv)), SHADOW_NEWS: "off" };
    const log: FetchLog = { urls: [], pushes: 0 };
    vi.stubGlobal("fetch", newsFetch(log));
    await worker.scheduled({ scheduledTime: at("2026-10-10T09:00").getTime(), cron: "*/15 * * * *", noRetry() {} }, env);
    expect(log.urls.some((u) => u.includes("news.google.com") || u.includes("gdelt"))).toBe(false);
    expect([...kv.data.keys()].some((k) => k.startsWith("shadow:"))).toBe(false);
  });

  it("makes no AI call while SHADOW_AI is off, even with a key", async () => {
    const kv = new FakeKV();
    const env = { ...(await makeEnv(kv)), ANTHROPIC_API_KEY: "k" };
    vi.stubGlobal("fetch", newsFetch({ urls: [], pushes: 0 }));
    const rec = (await runShadow(env, at("2026-10-10T09:00"), { gapMs: 0 }))!;
    expect(triageNews).not.toHaveBeenCalled();
    expect(rec.ai).toBeUndefined();
  });

  it("with SHADOW_AI on, triages once a day from 08:00 and charges the engine's AI budget", async () => {
    const kv = new FakeKV();
    const env = { ...(await makeEnv(kv)), ANTHROPIC_API_KEY: "k", SHADOW_AI: "on" };
    vi.stubGlobal("fetch", newsFetch({ urls: [], pushes: 0 }));

    expect((await runShadow(env, at("2026-10-10T07:00"), { gapMs: 0 }))!.ai).toBeUndefined();
    const rec = (await runShadow(env, at("2026-10-10T08:00"), { gapMs: 0 }))!;
    // Google has 3 headlines from the past day; GDELT 24h has none, so it costs no call.
    expect(triageNews).toHaveBeenCalledTimes(1);
    expect(rec.ai!["google-1d"]).toMatchObject({ ok: true, sent: 3, relevant: 1, titles: ["Flood closes road in Pai"] });
    expect(rec.ai!["gdelt-24h"]).toMatchObject({ sent: 0, relevant: 0 });
    expect(JSON.parse(kv.data.get("budget:2026-10-10")!).claude).toBe(1);

    await runShadow(env, at("2026-10-10T09:00"), { gapMs: 0 });
    expect(triageNews).toHaveBeenCalledTimes(1);
  });

  it("serves the log only with the access code", async () => {
    const kv = new FakeKV();
    const env = await makeEnv(kv);
    vi.stubGlobal("fetch", newsFetch({ urls: [], pushes: 0 }));
    await runShadow(env, new Date(Date.now() - (new Date().getUTCMinutes() % 60) * 60_000), { gapMs: 0 });

    expect((await worker.fetch(new Request("https://w/api/shadow"), env)).status).toBe(401);
    const res = await worker.fetch(new Request("https://w/api/shadow?days=2", { headers: { "X-Trip-Token": "secret" } }), env);
    expect(res.status).toBe(200);
    const log = (await res.json()) as Record<string, ShadowRecord[]>;
    expect(Object.values(log).flat()).toHaveLength(1);
  });
});
