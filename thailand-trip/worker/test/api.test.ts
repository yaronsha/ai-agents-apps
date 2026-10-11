import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { parsePreviewAt } from "../src/index";
import { fetchFlightStatus } from "../src/sources/flights";
import { Store } from "../src/store";
import { FakeKV, makeEnv, makeSubscription } from "./fakes";

afterEach(() => vi.unstubAllGlobals());

const post = (path: string, body: string) =>
  new Request(`https://w${path}`, { method: "POST", headers: { "X-Trip-Token": "secret" }, body });

describe("http api input", () => {
  it("accepts only a real preview moment in the documented format", () => {
    expect(parsePreviewAt("2026-11-26T12:00")?.toISOString()).toBe("2026-11-26T05:00:00.000Z");
    for (const bad of [null, "", "garbage", "2026-11-26 12:00", "2026-11-26T12:00:00", "2026-02-30T10:00", "2026-11-26T25:00"]) {
      expect(parsePreviewAt(bad)).toBeNull();
    }
  });

  it("runs only previews: no `at` or a bad one is a 400, never a real check", async () => {
    const env = await makeEnv(new FakeKV());
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    for (const query of ["", "?at=garbage"]) {
      const res = await worker.fetch(post(`/api/run${query}`, ""), env);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain("2026-11-26T12:00");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("answers 400 to a subscribe or unsubscribe body that isn't JSON", async () => {
    const env = await makeEnv(new FakeKV());
    expect((await worker.fetch(post("/api/subscribe", "not json"), env)).status).toBe(400);
    expect((await worker.fetch(post("/api/unsubscribe", "null"), env)).status).toBe(400);
    expect((await worker.fetch(post("/api/subscribe", JSON.stringify({ endpoint: 5 })), env)).status).toBe(400);
  });

  it("keeps both phones when they subscribe at the same moment", async () => {
    const env = await makeEnv(new FakeKV());
    const [a, b] = [await makeSubscription(), { ...(await makeSubscription()), endpoint: "https://push.example/other" }];
    await Promise.all([a, b].map((s) => worker.fetch(post("/api/subscribe", JSON.stringify(s)), env)));
    expect((await new Store(env.TRIP_KV).subs()).map((s) => s.endpoint).sort()).toEqual([a.endpoint, b.endpoint].sort());
  });

  it("still reads and removes devices saved in the old single list", async () => {
    const kv = new FakeKV();
    const env = await makeEnv(kv);
    const old = await makeSubscription();
    await kv.put("subs", JSON.stringify([old]));
    const store = new Store(env.TRIP_KV);
    expect(await store.subs()).toHaveLength(1);
    await worker.fetch(post("/api/unsubscribe", JSON.stringify({ endpoint: old.endpoint })), env);
    expect(await store.subs()).toHaveLength(0);
  });
});

describe("flight status", () => {
  it("reports nothing rather than another leg when no leg leaves our airport", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify([{ status: "Delayed", departure: { airport: { iata: "BKK" }, gate: "C3" } }]), { status: 200 }),
    );
    const flight = { id: "f", number: "TG 100", fromIata: "CNX", toIata: "BKK", departLocal: "2026-11-30T10:00", departUtcOffset: 7, labelHe: "" };
    expect(await fetchFlightStatus("k", flight)).toBeNull();
  });
});
