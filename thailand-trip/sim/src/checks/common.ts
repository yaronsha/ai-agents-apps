// Shared by the local live checks (npm run check:free, check:paid). These call real services, so
// they run only by hand on a developer machine, never in GitHub Actions.
//
// Every source is checked on up to three levels:
//   format       the worker's own fetch and parse code accepts the answer
//   correctness  the values are plausible (ranges, recency, known statuses)
//   reliability  an independent second source, or a planted case with a known answer, agrees
import { mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";

// Keys come from thailand-trip/.env (git-ignored). Variables already set in the shell win.
try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url).pathname);
} catch {
  // No .env: free checks need nothing, paid checks report their source as skipped.
}

export const REPORTS = new URL("../../reports/", import.meta.url).pathname;
export const flag = (name: string) => process.argv.includes(`--${name}`);
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type Level = "format" | "correctness" | "reliability";
export type Status = "ok" | "warn" | "failed" | "skipped";
export interface Row {
  source: string;
  level: Level;
  status: Status;
  note: string;
}

/** Thrown by a check to fail it with a readable reason. */
export class CheckFailed extends Error {}
/** Thrown by a check whose answer is usable but worth a look (a lagging source, a near miss). */
export class CheckWarning extends Error {}

export function expect(cond: unknown, what: string): asserts cond {
  if (!cond) throw new CheckFailed(what);
}
export function warnUnless(cond: unknown, what: string): void {
  if (!cond) throw new CheckWarning(what);
}

export class Report {
  readonly rows: Row[] = [];
  constructor(readonly title: string) {}

  skip(source: string, level: Level, why: string): void {
    this.rows.push({ source, level, status: "skipped", note: why });
  }

  /** Runs one check. Its return value is the note; a thrown error fails (or warns) it. */
  async check(source: string, level: Level, run: () => Promise<string>, needs?: string): Promise<boolean> {
    if (needs && !process.env[needs]) {
      this.skip(source, level, `no ${needs} in .env`);
      return false;
    }
    try {
      this.rows.push({ source, level, status: "ok", note: await run() });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const limited = / 429\b|limit requests|rate.?limit/i.test(msg);
      const status: Status = err instanceof CheckWarning ? "warn" : limited ? "skipped" : "failed";
      this.rows.push({ source, level, status, note: limited ? `rate-limited, try again later: ${msg}` : msg });
      return status === "warn";
    }
  }

  /** Prints the table, writes reports/<file>, and returns the exit code (1 if anything failed). */
  finish(file: string): number {
    const icon: Record<Status, string> = { ok: "✓", warn: "!", failed: "✗", skipped: "–" };
    const width = Math.max(...this.rows.map((r) => r.source.length));
    console.log(`\n${this.title}\n`);
    for (const r of this.rows) console.log(`${icon[r.status]} ${r.source.padEnd(width)}  ${r.level.padEnd(11)}  ${r.note}`);
    const count = (s: Status) => this.rows.filter((r) => r.status === s).length;
    const summary = `${count("ok")} ok, ${count("warn")} warnings, ${count("failed")} failed, ${count("skipped")} skipped`;
    console.log(`\n${summary}`);

    const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
    const md = [
      `# ${this.title}`,
      "",
      `Run ${new Date().toISOString()}. ${summary}.`,
      "",
      "| | Source | Level | Result |",
      "| --- | --- | --- | --- |",
      ...this.rows.map((r) => `| ${icon[r.status]} | ${cell(r.source)} | ${r.level} | ${cell(r.note)} |`),
      "",
    ].join("\n");
    mkdirSync(REPORTS, { recursive: true });
    writeFileSync(REPORTS + file, md);
    console.log(`Report: sim/reports/${file}`);
    return count("failed") ? 1 : 0;
  }
}

/** Asks y/N on the terminal; --yes answers yes (for a run you have already priced). */
export async function confirm(question: string): Promise<boolean> {
  if (flag("yes")) return true;
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

/** Keeps the last JSON body each host answered with, exactly as it came over the wire. */
export function recordBodies(): Map<string, unknown> {
  const bodies = new Map<string, unknown>();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await realFetch(input, init);
    const host = new URL(String(input instanceof Request ? input.url : input)).host;
    const copy = res.clone();
    if (copy.headers.get("content-type")?.includes("json")) bodies.set(host, await copy.json().catch(() => undefined));
    return res;
  };
  return bodies;
}
