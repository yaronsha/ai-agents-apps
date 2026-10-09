import { afterEach, describe, expect, it, vi } from "vitest";
import { aiProvider, replan, triageNews } from "../src/ai";
import worker from "../src/index";
import { FakeKV, makeEnv, trip } from "./fakes";

afterEach(() => vi.unstubAllGlobals());

/** Answers OpenAI's Responses API with `text` (or each of `text` in turn), recording what was asked. */
function stubOpenAI(text: string | string[], seen: Array<{ url: string; body: Record<string, unknown> }>, extra: Record<string, unknown> = {}) {
  const answers = [text].flat();
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    seen.push({ url: req.url, body: (await req.json()) as Record<string, unknown> });
    const text = answers[Math.min(seen.length, answers.length) - 1];
    const body = {
      id: "resp_1",
      object: "response",
      created_at: 0,
      status: "completed",
      model: "stub",
      output: [{ type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }],
      ...extra,
    };
    return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  };
}

const day = trip.days[3].date;
const articles = [
  { url: "https://a/1", title: "Landslide closes Route 1095", domain: "a", seendate: "" },
  { url: "https://a/2", title: "Football results", domain: "a", seendate: "" },
];

describe("ai provider", () => {
  it("picks the configured provider only when its key is set", async () => {
    const env = await makeEnv(new FakeKV());
    expect(aiProvider(env)).toBe(null);
    expect(aiProvider({ ...env, ANTHROPIC_API_KEY: "k" })).toBe("claude");
    expect(aiProvider({ ...env, AI_PROVIDER: "openai", ANTHROPIC_API_KEY: "k" })).toBe(null);
    expect(aiProvider({ ...env, AI_PROVIDER: "openai", OPENAI_API_KEY: "k" })).toBe("openai");
    expect(aiProvider({ ...env, AI_PROVIDER: "OpenAI", OPENAI_API_KEY: "k" })).toBe("openai");
  });

  it("triages news with OpenAI in two steps: a cheap filter, then the headlines it kept", async () => {
    const env = { ...(await makeEnv(new FakeKV())), AI_PROVIDER: "openai", OPENAI_API_KEY: "k", OPENAI_FILTER_MODEL: "gpt-5.4-nano" };
    const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
    const answer = {
      items: [{ index: 0, relevant: true, severity: "urgent", affectedDate: day, titleHe: "כביש 1095 חסום", bodyHe: "מפולת." }],
    };
    vi.stubGlobal("fetch", stubOpenAI([JSON.stringify({ relevant: [0] }), JSON.stringify(answer)], seen));
    const items = await triageNews(env, trip, day, articles);
    expect(items).toEqual([{ url: "https://a/1", date: day, severity: "urgent", titleHe: "כביש 1095 חסום", bodyHe: "מפולת." }]);
    expect(seen.map((s) => s.url)).toEqual(["https://api.openai.com/v1/responses", "https://api.openai.com/v1/responses"]);
    expect(seen.map((s) => s.body.model)).toEqual(["gpt-5.4-nano", "gpt-5.4-mini"]);
    expect(seen[0].body.input).toContain("Football results");
    expect(seen[1].body.input).toContain("Landslide closes Route 1095");
    expect(seen[1].body.input).not.toContain("Football results");
    expect(seen[1].body.reasoning).toEqual({ effort: "low" });
  });

  it("makes one call only when the filter keeps nothing", async () => {
    const env = { ...(await makeEnv(new FakeKV())), AI_PROVIDER: "openai", OPENAI_API_KEY: "k" };
    const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", stubOpenAI(JSON.stringify({ relevant: [] }), seen));
    expect(await triageNews(env, trip, day, articles)).toEqual([]);
    expect(seen).toHaveLength(1);
  });

  it("shows the flights and the later days to the model", async () => {
    const env = { ...(await makeEnv(new FakeKV())), AI_PROVIDER: "openai", OPENAI_API_KEY: "k" };
    const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", stubOpenAI(JSON.stringify({ relevant: [] }), seen));
    await triageNews(env, trip, trip.startDate, articles);
    const input = String(seen[0].body.input);
    expect(input).toContain(`${trip.days.at(-1)!.date}:`);
    for (const f of trip.flights) expect(input).toContain(`flight ${f.fromIata} to ${f.toIata}`);
  });

  it("reports a triage answer cut off by the token cap clearly", async () => {
    const env = { ...(await makeEnv(new FakeKV())), AI_PROVIDER: "openai", OPENAI_API_KEY: "k" };
    vi.stubGlobal("fetch", stubOpenAI('{"relevant":[0,', [], { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }));
    await expect(triageNews(env, trip, day, articles)).rejects.toThrow("OpenAI news filter incomplete: max_output_tokens");
  });

  it("fails the Claude news filter when it gives no answer, rather than reading it as nothing relevant", async () => {
    const env = { ...(await makeEnv(new FakeKV())), ANTHROPIC_API_KEY: "k" };
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "stub", content: [], stop_reason: "refusal", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );
    await expect(triageNews(env, trip, day, articles)).rejects.toThrow("Claude news filter gave no answer: refusal");
  });

  it("tells the app when the AI provider is out of credits", async () => {
    const env = { ...(await makeEnv(new FakeKV())), AI_PROVIDER: "openai", OPENAI_API_KEY: "k" };
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ error: { type: "insufficient_quota", code: "insufficient_quota", message: "You exceeded your current quota" } }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const res = await worker.fetch(
      new Request("https://w/api/replan", { method: "POST", headers: { "X-Trip-Token": "secret" }, body: JSON.stringify({ date: day }) }),
      env,
    );
    expect(res.status).toBe(502);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await res.json()).toEqual({ error: "נגמרה המכסה או הקרדיט אצל ספק ה־AI" });
  }, 20_000); // the SDK retries a 429 twice with backoff first

  it("re-plans with OpenAI through the http api", async () => {
    const env = { ...(await makeEnv(new FakeKV())), AI_PROVIDER: "openai", OPENAI_API_KEY: "k" };
    const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", stubOpenAI("לצאת ב־8:00 במקום 9:00.", seen));
    const res = await worker.fetch(
      new Request("https://w/api/replan", { method: "POST", headers: { "X-Trip-Token": "secret" }, body: JSON.stringify({ date: day, problem: "גשם" }) }),
      env,
    );
    expect(await res.json()).toEqual({ text: "לצאת ב־8:00 במקום 9:00." });
    expect(seen[0].body.model).toBe("gpt-5.5");
    expect(String(seen[0].body.input)).toContain("מה קרה: גשם");
  });

  it("says when OpenAI is chosen but has no key", async () => {
    const env = { ...(await makeEnv(new FakeKV())), AI_PROVIDER: "openai", ANTHROPIC_API_KEY: "k" };
    const res = await worker.fetch(
      new Request("https://w/api/replan", { method: "POST", headers: { "X-Trip-Token": "secret" }, body: JSON.stringify({ date: day }) }),
      env,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "אין מפתח OpenAI בשרת" });
  });

  it("returns the refusal note when OpenAI answers with no text", async () => {
    const env = { ...(await makeEnv(new FakeKV())), AI_PROVIDER: "openai", OPENAI_API_KEY: "k" };
    vi.stubGlobal("fetch", stubOpenAI("", []));
    expect(await replan(env, trip, day, [], "")).toContain("לא הצלחתי");
  });
});
