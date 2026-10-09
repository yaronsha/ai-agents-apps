// A scenario is one stretch of the trip, played out on a fast clock: what the outside world does
// (forecast changes, traffic, quakes, news, flight status) and what the app must do about it.
// All times are Thailand local time, "YYYY-MM-DDTHH:mm".
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

export type WeatherPreset = "storm" | "heavy-rain" | "cold" | "smoke" | "clear";

export type ScenarioEvent =
  | {
      at: string;
      /** The forecast for these stops changes from `at` on (the worker sees it on its next hourly refresh). */
      weather: { stops: string[]; from: string; to: string; preset: WeatherPreset };
      note?: string;
    }
  | {
      at: string;
      /** A quake shows up in the USGS feed, `km` from the stop, timed at `at`. */
      quake: { mag: number; nearStop: string; km: number; place: string };
      note?: string;
    }
  | {
      at: string;
      /**
       * The UK travel advice page is republished with this change note. `descriptionHe` is what the
       * simulated AI answers when the worker asks for a Hebrew translation.
       */
      advisory: { description: string; descriptionHe?: string };
      note?: string;
    }
  | {
      at: string;
      /**
       * A headline appears in the GDELT feed. `triage` is what the simulated Claude answers for it
       * (left out = Claude finds it irrelevant); with --real-claude the real model decides.
       */
      news: {
        title: string;
        domain: string;
        triage?: { severity: "urgent" | "warning" | "info"; affectedDate: string; titleHe: string; bodyHe: string };
      };
      note?: string;
    }
  | {
      at: string;
      /** Traffic on a planned drive from `at` on: `slowerPct` longer than usual, or no route at all. */
      traffic: { drive: string; slowerPct?: number; closed?: boolean };
      note?: string;
    }
  | {
      at: string;
      /** Flight status from `at` on, as AeroDataBox would report it. */
      flight: { flight: string; status?: string; delayMin?: number; gate?: string };
      note?: string;
    };

export type Expectation =
  /** This alert (id or id prefix) exists by `by` (default: end of the scenario). */
  | { alert: string; by?: string; severity?: "urgent" | "warning" | "info" }
  /** No alert with this id prefix appears (before `before`, if given). */
  | { noAlert: string; before?: string }
  /** This alert (id prefix) is still on screen at `at`. */
  | { visible: string; at: string }
  /** A push whose title contains `text` (and whose body does not contain `bodyNot`) is sent between the two times (default: any time). */
  | { push: string; after?: string; before?: string; bodyNot?: string }
  /** No push whose title contains `text` is sent. */
  | { noPush: string }
  /** The colour of a day at the end of the scenario. */
  | { day: string; status: "green" | "yellow" | "red" }
  /** At most this many pushes over the whole scenario (nobody wants a noisy app). */
  | { maxPushes: number };

export interface Scenario {
  id: string;
  name: string;
  description: string;
  start: string;
  end: string;
  /**
   * "calm" (default): recorded weather without its rain and storms, so only the scenario's own
   * weather events can trigger warnings. "recorded": the recorded week exactly as it was.
   */
  baseline?: "calm" | "recorded";
  /** Minutes between cron runs; the real worker runs every 15. */
  stepMin?: number;
  events: ScenarioEvent[];
  expect: Expectation[];
  /** Text the browser check must find on the alerts screen at the end of the scenario. */
  screen?: string[];
}

export const SCENARIO_DIR = new URL("../scenarios/", import.meta.url).pathname;

export function loadScenario(idOrPath: string): Scenario {
  const path = idOrPath.endsWith(".json") ? idOrPath : join(SCENARIO_DIR, `${idOrPath}.json`);
  const raw = JSON.parse(readFileSync(path, "utf8")) as Omit<Scenario, "id">;
  return { id: basename(path, ".json"), ...raw };
}

export function allScenarios(): Scenario[] {
  return readdirSync(SCENARIO_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => loadScenario(join(SCENARIO_DIR, f)));
}

export const thLocal = (local: string) => new Date(`${local}:00+07:00`);
export const thClock = (d: Date) => new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 16);
