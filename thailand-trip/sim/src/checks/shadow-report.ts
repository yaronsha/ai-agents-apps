// Reads the worker's news shadow log (GET /api/shadow) and compares the candidate sources:
// how often each answered, how far behind its newest headline was, and how much of it is
// about the route. Run by hand: npm run shadow:report [-- --days=N]
import { mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { REPORTS } from "./common";

interface Source {
  ok: boolean;
  error?: string;
  count: number;
  newestAgeMin: number | null;
  routeMentions: number;
}
interface Ai {
  ok: boolean;
  error?: string;
  sent: number;
  relevant: number;
}
interface ShadowRecord {
  at: string;
  sources: Record<string, Source>;
  ai?: Record<string, Ai>;
  error?: string;
}

const days = Number(process.argv.find((a) => a.startsWith("--days="))?.slice(7)) || 21;
const base = (process.env.WORKER_URL || "https://thailand-trip.yaron-shapira7.workers.dev").replace(/\/$/, "");

/** Asks for the access code without echoing it. */
async function askToken(): Promise<string> {
  if (!process.stdin.isTTY) return "";
  process.stdout.write("APP_TOKEN (not shown): ");
  const muted = new Writable({ write: (_c, _e, done) => done() });
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
  const token = await rl.question("");
  rl.close();
  process.stdout.write("\n");
  return token.trim();
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const hrs = (min: number | null) => (min === null ? "–" : min < 120 ? `${Math.round(min)} min` : `${(min / 60).toFixed(1)} h`);
const num = (x: number | null) => (x === null ? "–" : x.toFixed(1));

function verdict(okRate: number, lag: number | null, count: number | null): string {
  if (okRate < 0.8) return `unreliable: answered only ${Math.round(okRate * 100)}% of the hours`;
  if (lag === null || !count) return "returns nothing usable";
  if (lag > 24 * 60) return `too slow: newest headline is typically ${hrs(lag)} old`;
  if (lag > 6 * 60) return `usable but lagging (${hrs(lag)} typical)`;
  return `good candidate: fresh (${hrs(lag)} typical), ${num(count)} headlines an hour`;
}

async function main(): Promise<number> {
  const token = process.env.APP_TOKEN || (await askToken());
  if (!token) {
    console.error("No APP_TOKEN: set it in thailand-trip/.env or run this in a terminal to be asked for it.");
    return 1;
  }
  const res = await fetch(`${base}/api/shadow?days=${days}`, { headers: { "X-Trip-Token": token } });
  if (res.status === 404) {
    console.error(`${base} has no /api/shadow yet: shadow mode is not deployed.`);
    return 1;
  }
  if (res.status === 401) {
    console.error("The worker rejected the access code (401).");
    return 1;
  }
  if (!res.ok) {
    console.error(`${base}/api/shadow answered ${res.status}`);
    return 1;
  }
  const log = (await res.json()) as Record<string, ShadowRecord[]>;
  const records = Object.values(log).flat();
  if (!records.length) {
    console.log("No shadow records yet: deployed? Is SHADOW_NEWS on? The first one is written on the next full hour.");
    return 0;
  }

  const names = [...new Set(records.flatMap((r) => Object.keys(r.sources)))];
  const lines = [
    `# News shadow mode`,
    "",
    `${records.length} hourly records over ${Object.keys(log).length} days (${Object.keys(log)[0]} to ${Object.keys(log).at(-1)}), fetched ${new Date().toISOString()}.`,
    "",
    "| Source | Hours | Success | Median lag | Max lag | Avg headlines | Avg route mentions |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  const verdicts: string[] = [];
  for (const name of names) {
    const runs = records.map((r) => r.sources[name]).filter(Boolean);
    const ok = runs.filter((s) => s.ok);
    const lags = ok.flatMap((s) => (s.newestAgeMin === null ? [] : [s.newestAgeMin]));
    const count = avg(ok.map((s) => s.count));
    const row = [name, runs.length, `${Math.round((ok.length / runs.length) * 100)}%`, hrs(median(lags)), hrs(lags.length ? Math.max(...lags) : null), num(count), num(avg(ok.map((s) => s.routeMentions)))];
    lines.push(`| ${row.join(" | ")} |`);
    verdicts.push(`- **${name}**: ${verdict(ok.length / runs.length, median(lags), count)}`);
    const errors = [...new Set(runs.flatMap((s) => (s.error ? [s.error] : [])))].slice(0, 3);
    if (errors.length) verdicts.push(...errors.map((e) => `  - error: ${e.replace(/\|/g, "\\|")}`));
  }
  lines.push("", "## Verdict", "", ...verdicts);

  const aiDays = Object.entries(log).flatMap(([date, rs]) => rs.filter((r) => r.ai).map((r) => [date, r.ai!] as const));
  if (aiDays.length) {
    const aiNames = names.filter((n) => aiDays.some(([, a]) => a[n]));
    lines.push("", "## AI triage (relevant / sent, once a day)", "", `| Date | ${aiNames.join(" | ")} |`, `| --- | ${aiNames.map(() => "---").join(" | ")} |`);
    for (const [date, ai] of aiDays) {
      lines.push(`| ${date} | ${aiNames.map((n) => (!ai[n] ? "–" : ai[n].ok ? `${ai[n].relevant} / ${ai[n].sent}` : `error`)).join(" | ")} |`);
    }
  }
  const errored = records.filter((r) => r.error).length;
  if (errored) lines.push("", `${errored} runs ended early with an error (see the raw log).`);

  console.log(lines.filter((l) => !l.startsWith("| ---")).join("\n").replace(/\*\*/g, ""));
  mkdirSync(REPORTS, { recursive: true });
  writeFileSync(REPORTS + "shadow-news.md", lines.join("\n") + "\n");
  console.log("\nReport: sim/reports/shadow-news.md");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
