// npm run check:paid [-- --yes] [--replan] [--models gpt-5.4-mini,gpt-5.4-nano,claude-haiku-4-5] [--runs 3]
//
// Local, by-hand live check of the PAID sources, through the worker's own fetch and parse code:
// Google Routes, AeroDataBox and AI news triage on planted headlines (plus "re-plan for me" with
// --replan). Every call costs money or plan quota, so this never runs in CI. Keys come from
// thailand-trip/.env; a source without its key is reported as skipped. Before any call it prints
// the plan with a rough cost and asks; --yes answers yes, and without a terminal the answer is no.
// --models sets the triage models (gpt-* runs on OpenAI, claude-* on Anthropic). A model can answer
// differently each time, so each one sees the planted headlines --runs times (default 3) and must
// catch every relevant one every time.
import { distanceKm, placeOf, type NewsItem } from "@trip/shared";
import { fetchDriveTime } from "../../../worker/src/sources/routes";
import { fetchFlightStatus } from "../../../worker/src/sources/flights";
import type { Article } from "../../../worker/src/sources/gdelt";
import { replan, triageNews as openaiTriage } from "../../../worker/src/openai";
import { triageNews as claudeTriage } from "../../../worker/src/claude";
import type { Env } from "../../../worker/src/env";
import { simTrip } from "../world";
import { CheckFailed, confirm, expect, flag, recordBodies, Report, warnUnless } from "./common";

// $ per million tokens [input, output], from the providers' price pages (check them if a model changes).
const PRICES: Record<string, [number, number]> = {
  "gpt-5.4-nano": [0.2, 1.25],
  "gpt-5.4-mini": [0.75, 4.5],
  "gpt-5.5": [5, 30],
  "claude-haiku-4-5": [1, 5],
  "claude-sonnet-5-5": [3, 15],
};
// Rough tokens per call for the plan: the triage prompt is ~1.5k tokens, the answer (12 Hebrew items
// plus low-effort reasoning) ~3k; re-plan reasons at medium effort.
const TRIAGE_TOKENS: [number, number] = [1500, 3000];
const REPLAN_TOKENS: [number, number] = [1200, 3000];
// Compute Routes Pro (traffic-aware) is $10 per 1000 calls beyond the free monthly allowance.
const ROUTES_PER_CALL = 0.01;

const TRIAGE_DEFAULTS = ["gpt-5.4-mini", "gpt-5.4-nano", "claude-haiku-4-5"]; // wrangler.toml models + nano
const REPLAN_MODEL = "gpt-5.5";
const TODAY = "2026-11-24"; // lantern festival night; the drive to Pai on Route 1095 is tomorrow
const PAI_DRIVE_DATE = "2026-11-25";
// AeroDataBox's documented flight statuses; shared/src/rules.ts acts on /cancel/, flights.ts defaults to "Unknown".
const FLIGHT_STATUSES = ["Unknown", "Expected", "EnRoute", "CheckIn", "Boarding", "GateClosed", "Departed", "Delayed", "Approaching", "Arrived", "Canceled", "Diverted", "CanceledUncertain"];

const priceOf = (model: string) => Object.entries(PRICES).find(([k]) => model.startsWith(k))?.[1];
const costOf = (model: string, [i, o]: [number, number]) => {
  const p = priceOf(model);
  return p ? (i * p[0] + o * p[1]) / 1e6 : NaN;
};
const usd = (x: number) => (Number.isFinite(x) ? `$${x.toFixed(x < 0.01 ? 4 : 3)}` : "unknown price");

// Token usage of every AI call, read from the API's own answer.
interface Usage { model: string; input: number; output: number }
const usage: Usage[] = [];
const bodies = recordBodies();
const innerFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const res = await innerFetch(input, init);
  const url = String(input instanceof Request ? input.url : input);
  if (/api\.(openai|anthropic)\.com/.test(url) && res.headers.get("content-type")?.includes("json")) {
    const body = (await res.clone().json().catch(() => undefined)) as { model?: string; usage?: Record<string, number> } | undefined;
    const u = body?.usage;
    let model = body?.model ?? "?";
    try {
      model = JSON.parse(String(init?.body)).model ?? model;
    } catch {}
    if (u) usage.push({ model, input: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output: u.output_tokens ?? 0 });
  }
  return res;
};
const usageSince = (from: number) => {
  const calls = usage.slice(from);
  const input = calls.reduce((s, u) => s + u.input, 0);
  const output = calls.reduce((s, u) => s + u.output, 0);
  const cost = calls.reduce((s, u) => s + costOf(u.model, [u.input, u.output]), 0);
  return calls.length ? `${input} in / ${output} out tokens, ${usd(cost)}` : "no usage reported";
};

const report = new Report("Live check: paid sources");
const has = (k: string) => !!process.env[k];
const modelsArg = process.argv.find((a, i) => process.argv[i - 1] === "--models" || a.startsWith("--models="));
const runsArg = process.argv.find((a, i) => process.argv[i - 1] === "--runs" || a.startsWith("--runs="));
const RUNS = Math.max(1, Number(runsArg?.replace(/^--runs=/, "") ?? 3) || 3);
const models = (modelsArg?.replace(/^--models=/, "").split(",") ?? TRIAGE_DEFAULTS).map((m) => m.trim()).filter(Boolean);
const keyFor = (model: string) => (model.startsWith("claude") ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY");
const triageName = (model: string) => `news triage (${model.startsWith("claude") ? "Claude" : "OpenAI"} ${model})`;

const ROUTES = "drive time (Google Routes)";
const FLIGHT = "flight status (AeroDataBox)";
const REPLAN = `re-plan (OpenAI ${REPLAN_MODEL})`;
const LEVELS = ["format", "correctness", "reliability"] as const;

// ---- plan and cost guard
const plan: Array<{ source: string; calls: number; cost: string; est: number }> = [];
if (has("GOOGLE_MAPS_KEY")) plan.push({ source: ROUTES, calls: 1, cost: `~${usd(ROUTES_PER_CALL)} beyond the free monthly allowance`, est: ROUTES_PER_CALL });
if (has("RAPIDAPI_KEY") && has("LIVE_FLIGHT")) plan.push({ source: FLIGHT, calls: 1, cost: "1 request of the RapidAPI plan quota", est: 0 });
for (const m of models) if (has(keyFor(m))) plan.push({ source: triageName(m), calls: RUNS, cost: `~${usd(RUNS * costOf(m, TRIAGE_TOKENS))}`, est: RUNS * costOf(m, TRIAGE_TOKENS) || 0 });
if (flag("replan") && has("OPENAI_API_KEY")) plan.push({ source: REPLAN, calls: 1, cost: `~${usd(costOf(REPLAN_MODEL, REPLAN_TOKENS))}`, est: costOf(REPLAN_MODEL, REPLAN_TOKENS) });

let go = false;
if (plan.length) {
  const width = Math.max(...plan.map((p) => p.source.length));
  console.log("Paid calls planned:\n");
  for (const p of plan) console.log(`  ${p.source.padEnd(width)}  ${p.calls} call  ${p.cost}`);
  console.log(`\n  total ~${usd(plan.reduce((s, p) => s + p.est, 0))} (AI costs are estimates; actual usage is printed after)\n`);
  go = await confirm("Run these paid calls?");
  if (!go) console.log(process.stdin.isTTY ? "Declined; nothing was called." : "No terminal to ask on and no --yes; nothing was called.");
}
const declined = plan.length > 0 && !go;
const levelsOf = (source: string) => (source === REPLAN ? LEVELS.slice(0, 2) : LEVELS);
const skipAll = (source: string, why: string) => levelsOf(source).forEach((l) => report.skip(source, l, why));
const unavailable = (source: string, needs: string[]): boolean => {
  const missing = needs.filter((k) => !has(k));
  if (missing.length) skipAll(source, `no ${missing.join(", ")} in .env`);
  else if (declined) skipAll(source, "declined at the cost prompt");
  return missing.length > 0 || declined;
};
/** Runs the later levels only when the format check produced something to look at. */
const followUp = async (source: string, ok: boolean, rest: Array<[(typeof LEVELS)[number], () => Promise<string>]>) => {
  for (const [level, run] of rest) (ok ? await report.check(source, level, run) : report.skip(source, level, "format check failed"));
};

// ---- 1. Google Routes: the drive from Chiang Mai to Pai on Route 1095
if (!unavailable(ROUTES, ["GOOGLE_MAPS_KEY"])) {
  const drive = simTrip.days.flatMap((d) => d.drives).find((d) => d.id === "d25-pai")!;
  const from = placeOf(simTrip, drive.fromId)!;
  const to = placeOf(simTrip, drive.toId)!;
  const km = distanceKm(from, to);
  let reading: Awaited<ReturnType<typeof fetchDriveTime>> | undefined;
  const ok = await report.check(ROUTES, "format", async () => {
    reading = await fetchDriveTime(process.env.GOOGLE_MAPS_KEY!, from, to, new Date());
    expect("noRoute" in reading || (reading.durationSec > 0 && reading.staticSec > 0), "duration and staticDuration > 0, or no route");
    return "noRoute" in reading ? "no route" : `${drive.id}: ${Math.round(reading.durationSec / 60)} min (${Math.round(reading.staticSec / 60)} min without traffic)`;
  });
  await followUp(ROUTES, ok, [
    ["correctness", async () => {
      expect(reading && !("noRoute" in reading), "no route for a planned drive");
      const speed = km / (reading.durationSec / 3600);
      expect(speed >= 15 && speed <= 90, `implied straight-line speed ${speed.toFixed(0)} km/h over ${km.toFixed(0)} km, expected 15–90`);
      const ratio = reading.durationSec / reading.staticSec;
      warnUnless(ratio >= 0.7 && ratio <= 2.5, `traffic duration ${ratio.toFixed(2)}× the static one, expected 0.7–2.5×`);
      return `${km.toFixed(0)} km straight line, ${speed.toFixed(0)} km/h implied, traffic ${ratio.toFixed(2)}× static`;
    }],
    ["reliability", async () => {
      if (!reading || "noRoute" in reading) throw new CheckFailed("no route");
      const estimate = ((km * 1.4) / 50) * 3600;
      const off = reading.staticSec / estimate - 1;
      warnUnless(Math.abs(off) <= 0.4, `static ${Math.round(reading.staticSec / 60)} min is ${(off * 100).toFixed(0)}% off the mountain-road estimate of ${Math.round(estimate / 60)} min`);
      return `static ${Math.round(reading.staticSec / 60)} min vs estimate ${Math.round(estimate / 60)} min (${off >= 0 ? "+" : ""}${(off * 100).toFixed(0)}%)`;
    }],
  ]);
}

// ---- 2. AeroDataBox: one flight the caller names in LIVE_FLIGHT
if (!unavailable(FLIGHT, ["RAPIDAPI_KEY", "LIVE_FLIGHT"])) {
  const [number, date] = process.env.LIVE_FLIGHT!.trim().split(/ (?=\d{4}-\d{2}-\d{2}$)/);
  interface Raw { number?: string; status?: string; departure?: { scheduledTime?: { utc?: string; local?: string }; terminal?: string; gate?: string } }
  let raw: Raw | undefined;
  let status: Awaited<ReturnType<typeof fetchFlightStatus>> = null;
  const ok = await report.check(FLIGHT, "format", async () => {
    expect(number && date, `LIVE_FLIGHT like "EY 432 2026-10-20", got "${process.env.LIVE_FLIGHT}"`);
    status = await fetchFlightStatus(process.env.RAPIDAPI_KEY!, { id: "live", number, fromIata: "", toIata: "", departLocal: `${date}T00:00`, departUtcOffset: 0, labelHe: "" });
    expect(status, "a flight in the response");
    raw = (bodies.get("aerodatabox.p.rapidapi.com") as Raw[] | undefined)?.[0];
    return `${number}: ${status.status}, delay ${status.delayMin} min, gate ${status.gate ?? "-"}`;
  });
  await followUp(FLIGHT, ok, [
    ["correctness", async () => {
      expect(FLIGHT_STATUSES.includes(status!.status), `unknown status "${status!.status}"`);
      const sched = raw?.departure?.scheduledTime;
      expect(sched?.utc && !Number.isNaN(Date.parse(sched.utc.replace(" ", "T").replace(/Z?$/, "Z"))), "scheduled departure time parses");
      expect(sched.local?.slice(0, 10) === date, `departs ${sched.local}, not on ${date}`);
      return `${status!.status}, departs ${sched.local}`;
    }],
    ["reliability", async () => {
      const norm = (s?: string) => (s ?? "").replace(/\s/g, "").toUpperCase();
      expect(norm(raw?.number) === norm(number), `asked ${number}, answered ${raw?.number}`);
      warnUnless(raw?.departure?.gate || raw?.departure?.terminal, "no gate or terminal info");
      return `${raw!.number}, terminal ${raw!.departure?.terminal ?? "-"}, gate ${raw!.departure?.gate ?? "-"}`;
    }],
  ]);
}

// ---- 3. AI news triage on planted headlines
const seen = "20261124T060000Z";
const art = (slug: string, title: string, domain = "bangkokpost.com"): Article => ({ url: `https://planted.test/${slug}`, title, domain, seendate: seen });
// Each headline has a known answer for travellers on this itinerary.
const MUST = [
  art("landslide-1095", "Landslide closes Route 1095 between Mae Taeng and Pai"),
  art("mhs-floods", "Flash floods hit Mae Hong Son province, roads to Pai cut", "nationthailand.com"),
  art("khomloy-cancelled", "CAD Khomloy Sky Lantern Festival in Chiang Mai cancelled tonight over safety concerns", "chiangmaicitylife.com"),
  // The coming days are outdoors in the north (Pai canyon, waterfalls).
  art("north-rain", "Heavy rain warning issued for northern provinces this week", "thaipbsworld.com"),
  // "Until further notice": the flight home leaves from Chiang Mai.
  art("cnx-closed", "Chiang Mai airport closed until further notice after runway incident", "thaipbsworld.com"),
];
const MUST_NOT = [
  art("bkk-traffic", "Bangkok traffic gridlock on Sukhumvit as BTS line closes for maintenance"),
  art("phuket-ferry", "Phuket ferry to Phi Phi delayed by engine fault", "thephuketnews.com"),
  art("football", "Buriram United beat Port FC 2-1 in Thai League", "nationthailand.com"),
  art("cm-economy", "Chiang Mai property prices rise 4% as investors return", "chiangmaicitylife.com"),
  art("cr-crime", "Police in Chiang Rai arrest two men over online gambling ring"),
  // The old city is on the 23rd-24th; on Thursday the 26th they are in Pai. Tests that the model reads dates.
  art("cm-protest", "Protest planned in Chiang Mai old city on Thursday"),
];
const PLANTED = [MUST[0], MUST_NOT[0], MUST[1], MUST_NOT[1], MUST[3], MUST[2], MUST_NOT[2], MUST_NOT[3], MUST[4], MUST_NOT[5], MUST_NOT[4]];
const slug = (a: Article) => a.url.split("/").pop()!;
const HEBREW = /[֐-׿]/;

for (const model of models) {
  const source = triageName(model);
  if (unavailable(source, [keyFor(model)])) continue;
  const env = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, OPENAI_TRIAGE_MODEL: model, CLAUDE_TRIAGE_MODEL: model } as Env;
  const runs: NewsItem[][] = [];
  const from = usage.length;
  const ok = await report.check(source, "format", async () => {
    for (let i = 0; i < RUNS; i++) {
      const items = await (model.startsWith("claude") ? claudeTriage : openaiTriage)(env, simTrip, TODAY, PLANTED);
      expect(items.length, `run ${i + 1}: no relevant items (or the answer did not parse)`);
      expect(items.every((x) => ["urgent", "warning", "info"].includes(x.severity) && HEBREW.test(x.titleHe) && HEBREW.test(x.bodyHe)), `run ${i + 1}: severity and Hebrew title/body on every item`);
      runs.push(items);
    }
    return `${RUNS} runs, ${runs.map((r) => r.length).join("/")} of ${PLANTED.length} flagged; ${usageSince(from)}`;
  });
  console.log(`${source}: ${usageSince(from)}`);
  // How many runs flagged each headline.
  const times = (a: Article) => runs.filter((r) => r.some((i) => i.url === a.url)).length;
  await followUp(source, ok, [
    ["correctness", async () => {
      const missed = MUST.filter((a) => times(a) < RUNS).map((a) => `${slug(a)} ${times(a)}/${RUNS}`);
      const wrong = MUST_NOT.filter((a) => times(a) > 0).map((a) => `${slug(a)} ${times(a)}/${RUNS}`);
      const note = `every relevant headline caught in all ${RUNS} runs: ${missed.length ? "no" : "yes"}; irrelevant flagged: ${wrong.length ? wrong.join(", ") : "none"}`;
      expect(!missed.length, `MISSED ${missed.join(", ")}. ${note}`);
      warnUnless(!wrong.length, note);
      return note;
    }],
    ["reliability", async () => {
      const l = runs.map((r) => r.find((i) => i.url === MUST[0].url));
      expect(l.every(Boolean), "landslide not flagged in every run");
      expect(l.every((x) => x!.severity !== "info"), `landslide only "info" in a run`);
      const dates = l.map((x) => x!.date);
      warnUnless(dates.every((d) => d === PAI_DRIVE_DATE), `landslide dated ${dates.join(", ")}; the Pai drive is ${PAI_DRIVE_DATE}`);
      return `landslide: ${l.map((x) => x!.severity).join("/")}, ${PAI_DRIVE_DATE} every run, "${l[0]!.titleHe}"`;
    }],
  ]);
}

// ---- 4. Re-plan for me (only with --replan)
if (!flag("replan")) skipAll(REPLAN, `run with --replan (~${usd(costOf(REPLAN_MODEL, REPLAN_TOKENS))})`);
else if (!unavailable(REPLAN, ["OPENAI_API_KEY"])) {
  const env = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, OPENAI_REPLAN_MODEL: REPLAN_MODEL } as Env;
  let answer = "";
  const from = usage.length;
  const ok = await report.check(REPLAN, "format", async () => {
    answer = await replan(env, simTrip, PAI_DRIVE_DATE, [], "כביש 1095 לפאי נחסם הבוקר בגלל מפולת, לא ידוע מתי ייפתח.");
    expect(answer, "empty answer");
    return `${answer.split("\n").length} lines; ${usageSince(from)}`;
  });
  console.log(`${REPLAN}: ${usageSince(from)}${answer ? `\n${answer}\n` : ""}`);
  await followUp(REPLAN, ok, [
    ["correctness", async () => {
      expect(HEBREW.test(answer), "no Hebrew in the answer");
      expect(/במקום|חלופ|אלטרנטיב|תוכנית ב|לחלופין|לדחות|דחיית|מסלול אחר|דרך אחרת|להישאר|נשאר/.test(answer), "no alternative mentioned");
      return answer.split("\n")[0].slice(0, 100);
    }],
  ]);
}

if (usage.length) {
  console.log("\nAI usage:");
  for (const m of [...new Set(usage.map((u) => u.model))]) {
    const calls = usage.filter((u) => u.model === m);
    const [i, o] = [calls.reduce((s, u) => s + u.input, 0), calls.reduce((s, u) => s + u.output, 0)];
    console.log(`  ${m}: ${calls.length} call, ${i} in / ${o} out tokens, ${usd(costOf(m, [i, o]))}`);
  }
  console.log(`  total ${usd(usage.reduce((s, u) => s + costOf(u.model, [u.input, u.output]), 0))}`);
}

process.exit(report.finish("live-paid.md"));
