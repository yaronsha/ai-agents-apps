import { afterEach, describe, expect, it, vi } from "vitest";
import { thLocal } from "@trip/shared";
import { checkPlaces } from "../src/ai";
import { runCheck } from "../src/engine";
import { placeCheckDates, placeTargets } from "../src/places";
import { FakeKV, makeEnv, stubFetch, trip, type FetchLog } from "./fakes";

afterEach(() => vi.unstubAllGlobals());

const REAL = "https://www.khaosodenglish.com/news/mok-fa-closed";

/** A Claude answer that searched once (finding REAL) and then answered `items` as JSON. */
function claudeAnswer(items: unknown[], stop_reason = "end_turn") {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
    content: [
      { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "Mok Fa closed" } },
      { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [{ type: "web_search_result", url: REAL, title: "t", encrypted_content: "", page_age: null }] },
      ...(stop_reason === "pause_turn" ? [] : [{ type: "text", text: `Here is what I found:\n${JSON.stringify({ items })}` }]),
    ],
  };
}

const finding = (url: string) => ({ stopId: "mok-fa", date: "2026-11-25", severity: "urgent", titleHe: "מפל מוק פה סגור", bodyHe: "לפי Khaosod.", url });

function stubClaude(answers: unknown[], seen: Array<Record<string, unknown>>, rest = stubFetch({ urls: [], pushes: 0 })) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    if (new URL(req.url).host !== "api.anthropic.com") return rest(input, init);
    seen.push((await req.json()) as Record<string, unknown>);
    return new Response(JSON.stringify(answers[Math.min(seen.length - 1, answers.length - 1)]), { headers: { "Content-Type": "application/json" } });
  };
}

describe("place check schedule", () => {
  it("looks at today's and tomorrow's stops at 06:00 and 14:00 during the trip", () => {
    expect(placeCheckDates(trip, thLocal("2026-11-24T06:00"))).toEqual(["2026-11-24", "2026-11-25"]);
    expect(placeCheckDates(trip, thLocal("2026-11-24T14:10"))).toEqual(["2026-11-24", "2026-11-25"]);
    expect(placeCheckDates(trip, thLocal("2026-11-24T14:30"))).toEqual([]);
    expect(placeCheckDates(trip, thLocal("2026-11-24T10:00"))).toEqual([]);
  });

  it("looks at every stop once a week before the trip", () => {
    expect(placeCheckDates(trip, thLocal("2026-10-19T06:00"))).toHaveLength(trip.days.length); // a Monday
    expect(placeCheckDates(trip, thLocal("2026-10-20T06:00"))).toEqual([]);
  });

  it("skips the airport, which the flight check covers", () => {
    const ids = placeTargets(trip, ["2026-11-22"]).map((t) => t.stopId);
    expect(ids).toContain("doi-suthep");
    expect(ids).not.toContain("cnx-arrive");
  });
});

describe("checkPlaces with Claude", () => {
  const targets = placeTargets(trip, ["2026-11-25"]);

  it("keeps findings whose link the search returned and drops made-up links", async () => {
    const env = { ...(await makeEnv(new FakeKV())), ANTHROPIC_API_KEY: "k" };
    const seen: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", stubClaude([claudeAnswer([finding(REAL), finding("https://made.up/page")])], seen));
    const items = await checkPlaces(env, "2026-11-24", targets);
    expect(items).toEqual([{ ...finding(REAL), severity: "urgent" }]);
    expect(seen[0].tools).toEqual([{ type: "web_search_20250305", name: "web_search", max_uses: 2 * targets.length }]);
    expect(String((seen[0].messages as Array<{ content: string }>)[0].content)).toContain("stopId mok-fa");
  });

  it("carries on a search turn that paused", async () => {
    const env = { ...(await makeEnv(new FakeKV())), ANTHROPIC_API_KEY: "k" };
    const seen: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", stubClaude([claudeAnswer([], "pause_turn"), claudeAnswer([finding(REAL)])], seen));
    expect(await checkPlaces(env, "2026-11-24", targets)).toHaveLength(1);
    expect((seen[1].messages as unknown[]).length).toBe(2);
  });

  it("fails clearly when the answer has no JSON", async () => {
    const env = { ...(await makeEnv(new FakeKV())), ANTHROPIC_API_KEY: "k" };
    const answer = { ...claudeAnswer([]), content: [{ type: "text", text: "Sorry." }] };
    vi.stubGlobal("fetch", stubClaude([answer], []));
    await expect(checkPlaces(env, "2026-11-24", targets)).rejects.toThrow(/no JSON/);
  });
});

describe("place check in the cron run", () => {
  it("turns a finding into an alert, keeps it, and replaces it when the stop is checked again", async () => {
    const kv = new FakeKV();
    const env = { ...(await makeEnv(kv)), ANTHROPIC_API_KEY: "k" };
    const log: FetchLog = { urls: [], pushes: 0 };
    const seen: Array<Record<string, unknown>> = [];
    const placeCalls = () => seen.filter((b) => String(b.system).includes("You check places")).length;
    vi.stubGlobal("fetch", stubClaude([claudeAnswer([finding(REAL)])], seen, stubFetch(log)));

    const state = await runCheck(env, thLocal("2026-11-24T14:00"));
    const alert = state.alerts.find((a) => a.id === `site:mok-fa:${REAL}`);
    expect(alert).toMatchObject({ category: "place", severity: "urgent", date: "2026-11-25" });
    expect(state.sources.places.ok).toBe(true);
    const calls = placeCalls();
    expect(calls).toBeGreaterThan(0);

    // Between checks the finding stays, with no new searches.
    const later = await runCheck(env, thLocal("2026-11-24T16:00"));
    expect(later.alerts.some((a) => a.id === alert!.id)).toBe(true);
    expect(placeCalls()).toBe(calls);

    // The next check finds the place open again: the old finding goes.
    vi.stubGlobal("fetch", stubClaude([claudeAnswer([])], seen, stubFetch(log)));
    const next = await runCheck(env, thLocal("2026-11-25T06:00"));
    expect(next.alerts.some((a) => a.id === alert!.id)).toBe(false);
  });

  it("shows the bundled facts without any AI key", async () => {
    const env = await makeEnv(new FakeKV());
    vi.stubGlobal("fetch", stubFetch({ urls: [], pushes: 0 }));
    const state = await runCheck(env, thLocal("2026-11-24T06:00"));
    expect(state.alerts.some((a) => a.id === "place:pha-soet:closed")).toBe(true);
    expect(state.sources.places).toBeUndefined();
  });
});
