import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { addDays, hhmm, type NewsItem, type PlaceNotice, type Trip, type TripAlert } from "@trip/shared";
import type { Article } from "./sources/gdelt";
import type { Env } from "./env";

function client(env: Env): Anthropic {
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

/** A compact plain-text version of the days from `from` onwards, for prompts. */
export function tripOutline(trip: Trip, from: string, days = 4): string {
  const until = addDays(from, days);
  return trip.days
    .filter((d) => d.date >= from && d.date < until)
    .map((d) => `${d.date}: ${d.stops.map((s) => `${hhmm(s.start)} ${s.nameEn}`).join(", ")}`)
    .join("\n");
}

export const Triage = z.object({
  items: z.array(
    z.object({
      index: z.number().int(),
      relevant: z.boolean(),
      severity: z.enum(["urgent", "warning", "info"]),
      affectedDate: z.string().describe("YYYY-MM-DD trip day affected, or empty if unclear"),
      titleHe: z.string().describe("Short Hebrew headline for the travellers"),
      bodyHe: z.string().describe("One or two Hebrew sentences: what happened and what to do"),
    }),
  ),
});

export const TRIAGE_SYSTEM = `You screen news for two Israeli tourists on a private-driver trip in northern Thailand.
Given their next few days and a list of headlines, decide which headlines could change their plans: closed roads, landslides, floods, protests, closed parks or temples, cancelled festivals or flights, border incidents, disease outbreaks, severe smoke.
Mark a headline relevant only when it plausibly affects a place or road on their route in the coming days. Most headlines are not relevant.
"urgent" means they should act today or tomorrow; "warning" means worth planning around; "info" means good to know.
Write titleHe and bodyHe in natural Hebrew. Return one entry per headline index.`;

export function triagePrompt(trip: Trip, today: string, articles: Article[]): string {
  const list = articles.map((a, i) => `${i}. [${a.domain}, ${a.seendate}] ${a.title}`).join("\n");
  return `Today is ${today}.\n\nItinerary:\n${tripOutline(trip, today)}\n\nHeadlines:\n${list}`;
}

/** The relevant headlines from a triage answer, as news items. */
export function toNewsItems(parsed: z.infer<typeof Triage> | null, articles: Article[], today: string): NewsItem[] {
  if (!parsed) return [];
  return parsed.items
    .filter((x) => x.relevant && articles[x.index])
    .map((x) => ({
      url: articles[x.index].url,
      date: /^\d{4}-\d{2}-\d{2}$/.test(x.affectedDate) ? x.affectedDate : today,
      severity: x.severity,
      titleHe: x.titleHe,
      bodyHe: x.bodyHe,
    }));
}

/**
 * News triage runs before the roads and flights checks in the same cron run, so a slow model
 * must not hold them up: the SDK default is 10 minutes and 2 retries.
 */
export const TRIAGE_REQUEST = { timeout: 20_000, maxRetries: 1 } as const;

export async function triageNews(env: Env, trip: Trip, today: string, articles: Article[]): Promise<NewsItem[]> {
  if (!articles.length) return [];
  const response = await client(env).messages.parse({
    model: env.CLAUDE_TRIAGE_MODEL,
    max_tokens: 4000,
    system: TRIAGE_SYSTEM,
    messages: [{ role: "user", content: triagePrompt(trip, today, articles) }],
    output_config: { format: zodOutputFormat(Triage) },
  }, TRIAGE_REQUEST);
  return toNewsItems(response.parsed_output, articles, today);
}

export const ADVISORY_SYSTEM = `Translate this change note from the UK government's travel advice for Thailand into short, natural Hebrew for two Israeli tourists.
Keep place names in English letters. Reply with the Hebrew text only.`;

/** The advisory change note in Hebrew (the triage model is enough for a short translation). */
export async function translateAdvisory(env: Env, text: string): Promise<string> {
  // It runs before the flight check in the same cron run, and the English note is a fine fallback.
  const response = await client(env).messages.create(
    { model: env.CLAUDE_TRIAGE_MODEL, max_tokens: 2000, system: ADVISORY_SYSTEM, messages: [{ role: "user", content: text }] },
    { timeout: 15_000, maxRetries: 1 },
  );
  return response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
}

export const REPLAN_SYSTEM = `אתה עוזר תכנון לזוג ישראלים בטיול בצפון תאילנד עם נהג פרטי וואן.
כשמשהו משתבש, הצע תוכנית מעודכנת ליום הזה: שעות יציאה, סדר עצירות, מה לבטל ומה להוסיף במקום.
העדף שינויים קטנים וריאליים: מרחקי נסיעה אמיתיים, שעות פתיחה סבירות, וזמן מנוחה.
כתוב בעברית פשוטה, עד 12 שורות, ובסוף שורה אחת על מה כדאי לבדוק או לתאם עם הנהג.`;

export function replanPrompt(trip: Trip, date: string, alerts: TripAlert[], problem: string): string {
  const day = trip.days.find((d) => d.date === date);
  if (!day) throw new Error(`no trip day ${date}`);
  const stops = day.stops.map((s) => `${hhmm(s.start)}-${hhmm(s.end)} ${s.nameHe} (${s.nameEn})`).join("\n");
  const active = alerts.filter((a) => a.date === date).map((a) => `- ${a.titleHe}: ${a.bodyHe}`).join("\n") || "אין";
  return `היום: ${date}, ${day.titleHe}\n\nהתוכנית:\n${stops}\n\nהתראות פעילות:\n${active}\n\nתוכניות ב' שהכנו מראש:\n${day.planB.join("\n")}\n\nמה קרה: ${problem || "תתאים את היום להתראות הפעילות."}`;
}

export const REPLAN_REFUSED = "לא הצלחתי להציע תוכנית הפעם. נסו לנסח את הבעיה אחרת.";

export async function replan(env: Env, trip: Trip, date: string, alerts: TripAlert[], problem: string): Promise<string> {
  const content = replanPrompt(trip, date, alerts, problem);
  const response = await client(env).beta.messages.create({
    model: env.CLAUDE_REPLAN_MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: REPLAN_SYSTEM,
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal") return REPLAN_REFUSED;
  return response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
}

/** A stop to look up on the web: what we plan there and what we already know about it. */
export interface PlaceTarget {
  stopId: string;
  date: string;
  start: string;
  end: string;
  nameEn: string;
  nameTh?: string;
  lat: number;
  lng: number;
  known: string;
  officialUrls: string[];
}

export const PlaceCheck = z.object({
  items: z.array(
    z.object({
      stopId: z.string(),
      date: z.string().describe("YYYY-MM-DD visit date this affects"),
      severity: z.enum(["urgent", "warning", "info"]),
      titleHe: z.string().describe("Short Hebrew headline"),
      bodyHe: z.string().describe("One or two Hebrew sentences: what changed, per which source, what to do"),
      url: z.string().describe("The page the finding comes from"),
    }),
  ),
});

export const PLACES_SYSTEM = `You check places on the plan of two Israeli tourists in northern Thailand, before each visit.
For each place, search the web for anything that would change the visit on its date: a temporary closure, a closed trail, waterfall or cave, changed opening hours or closed days, a cancelled or moved event, a higher entry fee or a change in how to pay. Search the official page when one is given, Thai national park notices, and Thai and English news; search in Thai as well, since local notices are often only in Thai.
Report a finding only when a page you found in this search says it and it is recent or clearly still in force on the visit date. "What we know" is what travel guides said earlier; report a difference from it only when a newer source shows it. Most places have nothing new: report nothing for them.
"urgent": closed, cancelled or unreachable on the visit date. "warning": partly closed or hours changed in a way that affects the planned time. "info": price, payment or minor changes.
Write titleHe and bodyHe in natural Hebrew, name the source in bodyHe, and keep place names in English letters.`;

const PLACES_JSON = `Answer with JSON only, no other text: {"items":[{"stopId":"...","date":"YYYY-MM-DD","severity":"urgent|warning|info","titleHe":"...","bodyHe":"...","url":"https://..."}]}. Use {"items":[]} when nothing changed.`;

export function placesPrompt(today: string, targets: PlaceTarget[]): string {
  const list = targets
    .map((t) => {
      const name = t.nameTh ? `${t.nameEn} (${t.nameTh})` : t.nameEn;
      const official = t.officialUrls.length ? `\n  official: ${t.officialUrls.join(" ")}` : "";
      return `- stopId ${t.stopId}: ${name}, near ${t.lat.toFixed(3)},${t.lng.toFixed(3)}. Visit ${t.date} ${hhmm(t.start)}-${hhmm(t.end)}.\n  what we know: ${t.known || "nothing"}${official}`;
    })
    .join("\n");
  return `Today is ${today}.\n\nPlaces:\n${list}`;
}

/** The answer's findings about the places asked, with sane dates and links. */
export function toPlaceNotices(parsed: z.infer<typeof PlaceCheck> | null, targets: PlaceTarget[], urlOk: (url: string) => boolean = () => true): PlaceNotice[] {
  if (!parsed) return [];
  return parsed.items.flatMap((x) => {
    const target = targets.find((t) => t.stopId === x.stopId);
    if (!target || !/^https?:\/\//.test(x.url) || !urlOk(x.url)) return [];
    const date = targets.some((t) => t.stopId === x.stopId && t.date === x.date) ? x.date : target.date;
    return [{ stopId: x.stopId, date, severity: x.severity, titleHe: x.titleHe, bodyHe: x.bodyHe, url: x.url }];
  });
}

/** Web searches take a while; this runs last in the cron run, but must still end well inside it. */
export const PLACES_REQUEST = { timeout: 90_000, maxRetries: 1 } as const;

/** The JSON object at the end of a text answer, or null. */
export function lastJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Looks the places up with Claude's web search. A finding counts only if its link is one the search
 * actually returned (or an official page we gave), so a made-up link never becomes an alert.
 */
export async function checkPlaces(env: Env, today: string, targets: PlaceTarget[]): Promise<PlaceNotice[]> {
  if (!targets.length) return [];
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: placesPrompt(today, targets) }];
  const found = new Set(targets.flatMap((t) => t.officialUrls));
  for (let round = 0; round < 3; round++) {
    const response = await client(env).messages.create(
      {
        model: env.CLAUDE_TRIAGE_MODEL,
        max_tokens: 8000,
        system: `${PLACES_SYSTEM}\n${PLACES_JSON}`,
        messages,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: Math.min(2 * targets.length, 10) }],
      },
      PLACES_REQUEST,
    );
    for (const b of response.content) {
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content) found.add(r.url);
    }
    // A long search turn pauses; sending it back lets the server carry on where it stopped.
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
    const parsed = PlaceCheck.safeParse(lastJson(text));
    if (!parsed.success) throw new Error(`place check: no JSON answer (${response.stop_reason})`);
    const norm = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
    const seen = new Set([...found].map(norm));
    return toPlaceNotices(parsed.data, targets, (u) => seen.has(norm(u)));
  }
  throw new Error("place check: the search did not finish");
}
