import { afterEach, describe, expect, it, vi } from "vitest";
import { aiProvider, replan, triageNews } from "../src/ai";
import worker from "../src/index";
import { FakeKV, makeEnv, trip } from "./fakes";

afterEach(() => vi.unstubAllGlobals());

/** Answers OpenAI's Responses API with `text`, recording what was asked. */
function stubOpenAI(text: string, seen: Array<{ url: string; body: Record<string, unknown> }>) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    seen.push({ url: req.url, body: (await req.json()) as Record<string, unknown> });
    const body = {
      id: "resp_1",
      object: "response",
      created_at: 0,
      status: "completed",
      model: "stub",
      output: [{ type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }],
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
  });

  it("triages news with OpenAI when configured", async () => {
    const env = { ...(await makeEnv(new FakeKV())), AI_PROVIDER: "openai", OPENAI_API_KEY: "k" };
    const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
    const answer = {
      items: [
        { index: 0, relevant: true, severity: "urgent", affectedDate: day, titleHe: "כביש 1095 חסום", bodyHe: "מפולת." },
        { index: 1, relevant: false, severity: "info", affectedDate: "", titleHe: "", bodyHe: "" },
      ],
    };
    vi.stubGlobal("fetch", stubOpenAI(JSON.stringify(answer), seen));
    const items = await triageNews(env, trip, day, articles);
    expect(items).toEqual([{ url: "https://a/1", date: day, severity: "urgent", titleHe: "כביש 1095 חסום", bodyHe: "מפולת." }]);
    expect(seen[0].url).toBe("https://api.openai.com/v1/responses");
    expect(seen[0].body.model).toBe("gpt-5.4-mini");
  });

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
