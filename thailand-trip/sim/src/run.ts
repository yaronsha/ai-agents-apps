// npm run sim [-- <scenario>... ] [--browser] [--real-claude] [--serve]
//
// Plays each scenario through the real worker on a fast clock: one cron run per 15 simulated
// minutes, the outside world answering from recordings plus the scenario's events. Prints the
// day as the travellers would live it, checks the scenario's expectations, and writes a report
// to sim/reports/. --browser also opens the real app in Chromium and checks what it shows.
import { mkdirSync, writeFileSync } from "node:fs";
import type { TripAlert, TripState } from "@trip/shared";
import { allScenarios, loadScenario, thClock, thLocal, type Expectation, type Scenario, type ScenarioEvent } from "./scenario";
import { World } from "./world";
import { startWorker } from "./worker";
import type { ReceivedPush } from "./push";

const REPORTS = new URL("../reports/", import.meta.url).pathname;
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const ids = args.filter((a) => !a.startsWith("--"));

export interface Line {
  at: string;
  kind: "event" | "alert" | "cleared" | "push" | "error";
  text: string;
}

export interface Result {
  scenario: Scenario;
  lines: Line[];
  pushes: ReceivedPush[];
  firstSeen: Map<string, { at: string; alert: TripAlert }>;
  /** The alert ids on screen after each cron run. */
  snapshots: Array<{ at: string; ids: Set<string> }>;
  final: TripState;
  checks: Array<{ ok: boolean; text: string }>;
  calls: Record<string, number>;
}

function describe(e: ScenarioEvent): string {
  if (e.note) return e.note;
  if ("weather" in e) return `forecast for ${e.weather.stops.join(", ")} ${e.weather.from.slice(11)}-${e.weather.to.slice(11)}: ${e.weather.preset}`;
  if ("quake" in e) return `M${e.quake.mag} quake ${e.quake.km} km from ${e.quake.nearStop} (${e.quake.place})`;
  if ("advisory" in e) return `UK travel advice updated: ${e.advisory.description}`;
  if ("news" in e) return `headline: ${e.news.title}`;
  if ("traffic" in e) return `traffic on ${e.traffic.drive}: ${e.traffic.closed ? "no route" : `+${e.traffic.slowerPct}%`}`;
  return `flight ${e.flight.flight}: ${[e.flight.status, e.flight.delayMin && `+${e.flight.delayMin} min`, e.flight.gate && `gate ${e.flight.gate}`].filter(Boolean).join(", ")}`;
}

export async function play(scenario: Scenario, opts: { realClaudeKey?: string; port?: number } = {}) {
  const world = new World(scenario, opts);
  const worker = await startWorker(world, { port: opts.port });
  const kv = await worker.kv();
  await kv.put("subs", JSON.stringify([world.push.subscription]));

  const lines: Line[] = [];
  const firstSeen = new Map<string, { at: string; alert: TripAlert }>();
  const snapshots: Result["snapshots"] = [];
  let previous = new Set<string>();
  let state: TripState | null = null;
  const step = (scenario.stepMin ?? 15) * 60_000;
  let last = thLocal(scenario.start).getTime() - step;

  for (let t = thLocal(scenario.start).getTime(); t <= thLocal(scenario.end).getTime(); t += step) {
    const now = new Date(t);
    const clock = thClock(now);
    world.now = now;
    for (const e of scenario.events) {
      const at = thLocal(e.at).getTime();
      if (at > last && at <= t) lines.push({ at: e.at, kind: "event", text: describe(e) });
    }
    const pushesBefore = world.push.received.length;
    try {
      await worker.tick(now);
    } catch (err) {
      lines.push({ at: clock, kind: "error", text: String(err) });
    }
    state = await worker.api<TripState>("/api/state");
    const current = new Set<string>();
    for (const a of state.alerts.filter((x) => x.category !== "reminder")) {
      current.add(a.id);
      if (!firstSeen.has(a.id)) firstSeen.set(a.id, { at: clock, alert: a });
      if (!previous.has(a.id)) lines.push({ at: clock, kind: "alert", text: `[${a.severity}] ${a.titleHe}  (${a.id}, ${a.date})` });
    }
    for (const id of previous) if (!current.has(id)) lines.push({ at: clock, kind: "cleared", text: id });
    for (const p of world.push.received.slice(pushesBefore)) lines.push({ at: clock, kind: "push", text: `${p.title} | ${p.body.replace(/\n/g, " / ")}` });
    for (const [source, s] of Object.entries(state.sources)) {
      if (!s.ok) lines.push({ at: clock, kind: "error", text: `${source}: ${s.note}` });
    }
    snapshots.push({ at: clock, ids: current });
    previous = current;
    last = t;
  }
  for (const u of new Set(world.unexpected)) lines.push({ at: scenario.end, kind: "error", text: `request the simulator cannot answer: ${u}` });

  const calls: Record<string, number> = {};
  for (const c of world.calls) calls[c.source] = (calls[c.source] ?? 0) + 1;
  const result: Result = { scenario, lines, pushes: world.push.received, firstSeen, snapshots, final: state!, checks: [], calls };
  result.checks = scenario.expect.map((x) => check(x, result));
  if (world.unexpected.length) result.checks.push({ ok: false, text: "the worker called a service the simulator does not know" });
  return { result, worker, world };
}

function check(x: Expectation, r: Result): { ok: boolean; text: string } {
  const matching = (prefix: string) => [...r.firstSeen.entries()].filter(([id]) => id.startsWith(prefix));
  const pushHas = (p: ReceivedPush, text: string) => p.title.includes(text);
  if ("alert" in x) {
    const seen = matching(x.alert)[0]?.[1];
    const by = x.by ?? r.scenario.end;
    const finalAlert = r.final.alerts.find((a) => a.id.startsWith(x.alert));
    const ok = Boolean(seen && seen.at <= by && (!x.severity || (finalAlert ?? seen.alert).severity === x.severity));
    return { ok, text: `alert ${x.alert}${x.severity ? ` (${x.severity})` : ""} by ${by.slice(11)}: ${seen ? `appeared ${seen.at.slice(11)} as ${(finalAlert ?? seen.alert).severity}` : "never appeared"}` };
  }
  if ("noAlert" in x) {
    const seen = matching(x.noAlert).filter(([, s]) => !x.before || s.at < x.before);
    return { ok: !seen.length, text: `no alert ${x.noAlert}${x.before ? ` before ${x.before.slice(11)}` : ""}: ${seen.length ? `but saw ${seen.map(([id, s]) => `${id} at ${s.at.slice(11)}`).join(", ")}` : "none"}` };
  }
  if ("visible" in x) {
    const snap = r.snapshots.filter((s) => s.at <= x.at).at(-1);
    const ok = Boolean(snap && [...snap.ids].some((id) => id.startsWith(x.visible)));
    return { ok, text: `alert ${x.visible} still shown at ${x.at.slice(11)}: ${ok ? "yes" : "no"}` };
  }
  if ("push" in x) {
    const hits = r.pushes.filter((p) => pushHas(p, x.push) && (!x.bodyNot || !p.body.includes(x.bodyNot)));
    const inWindow = hits.filter((p) => (!x.after || thClock(p.at) >= x.after) && (!x.before || thClock(p.at) <= x.before));
    const window = x.after || x.before ? ` between ${x.after?.slice(11) ?? "start"} and ${x.before?.slice(11) ?? "end"}` : "";
    const not = x.bodyNot ? ` without "${x.bodyNot}" in its text` : "";
    return { ok: inWindow.length > 0, text: `push "${x.push}"${not}${window}: ${hits.length ? `sent at ${hits.map((p) => thClock(p.at).slice(11)).join(", ")}` : "not sent"}` };
  }
  if ("noPush" in x) {
    const hits = r.pushes.filter((p) => pushHas(p, x.noPush));
    return { ok: !hits.length, text: `no push "${x.noPush}": ${hits.length ? `but sent at ${hits.map((p) => thClock(p.at).slice(11)).join(", ")}` : "none"}` };
  }
  if ("day" in x) {
    const got = r.final.dayStatus[x.day];
    return { ok: got === x.status, text: `day ${x.day} is ${x.status}: ${got}` };
  }
  return { ok: r.pushes.length <= x.maxPushes, text: `at most ${x.maxPushes} pushes: ${r.pushes.length}` };
}

const ICON: Record<Line["kind"], string> = { event: "◆ world ", alert: "▲ alert ", cleared: "▽ gone  ", push: "🔔 push  ", error: "✖ error " };

export function report(r: Result, browser?: { ok: boolean; lines: string[] }): string {
  const s = r.scenario;
  const out = [
    `# ${s.name} (${s.id})`,
    "",
    s.description,
    "",
    `Simulated ${s.start.replace("T", " ")} to ${s.end.slice(11)} Thailand time, one cron run every ${s.stepMin ?? 15} minutes.`,
    `Calls to the outside world: ${Object.entries(r.calls).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}.`,
    "",
    "## Timeline",
    "",
    "```",
    ...r.lines.map((l) => `${l.at.slice(11)}  ${ICON[l.kind]} ${l.text}`),
    "```",
    "",
    "## Checks",
    "",
    ...r.checks.map((c) => `- ${c.ok ? "✓" : "✗"} ${c.text}`),
    ...(browser ? ["", "## In the app (Chromium)", "", ...browser.lines.map((l) => `- ${l}`)] : []),
    "",
  ];
  return out.join("\n");
}

async function main() {
  const scenarios = ids.length ? ids.map(loadScenario) : allScenarios();
  const realClaudeKey = flag("real-claude") ? process.env.ANTHROPIC_API_KEY : undefined;
  if (flag("real-claude") && !realClaudeKey) throw new Error("--real-claude needs ANTHROPIC_API_KEY in the environment");
  mkdirSync(REPORTS, { recursive: true });
  const browserCheck = flag("browser") ? await import("./browser") : null;
  const app = browserCheck ? await browserCheck.startApp() : null;
  let failed = 0;

  for (const scenario of scenarios) {
    const { result, worker } = await play(scenario, { realClaudeKey, port: flag("serve") ? 8787 : undefined });
    const browser = app && browserCheck ? await browserCheck.checkInBrowser(app, worker.url, result, REPORTS) : undefined;
    const text = report(result, browser);
    writeFileSync(`${REPORTS}${scenario.id}.md`, text);
    console.log(text);
    const ok = result.checks.every((c) => c.ok) && (browser?.ok ?? true);
    if (!ok) failed++;
    console.log(ok ? `PASS ${scenario.id}\n` : `FAIL ${scenario.id}\n`);
    if (flag("serve")) {
      console.log(`Worker with the end state of "${scenario.name}" is at ${worker.url} (access code: sim-token). Ctrl+C to stop.`);
      if (app) console.log(`App: ${app.url}`);
      await new Promise(() => undefined);
    }
    await worker.dispose();
  }
  await app?.close();
  console.log(`${scenarios.length - failed}/${scenarios.length} scenarios passed. Reports in sim/reports/.`);
  process.exit(failed ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
