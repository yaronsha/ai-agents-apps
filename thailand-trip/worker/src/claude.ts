import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { addDays, hhmm, type NewsItem, type Trip, type TripAlert } from "@trip/shared";
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

/** What a long disruption could still hit: the rest of the trip, one line a day, and the flights (no numbers). */
export function tripFixedPoints(trip: Trip, from: string): string {
  const later = trip.days
    .filter((d) => d.date >= addDays(from, 4))
    .map((d) => `${d.date}: ${d.stops.map((s) => s.nameEn).join(", ")}`);
  const flights = trip.flights.map((f) => `${f.departLocal?.slice(0, 10) ?? "date not set"}: flight ${f.fromIata} to ${f.toIata}`);
  return [...later, ...flights].join("\n");
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

// Triage runs in two steps. A cheap filter call sees every new headline and answers only with the
// numbers of those that could matter; most hours that list is empty and nothing else is called.
// Then the triage call sees just those headlines and writes severity, date and the Hebrew text.
export const Filter = z.object({ relevant: z.array(z.number().int()) });

export const FILTER_SYSTEM = `You screen news for two Israeli tourists on a private-driver trip in northern Thailand.
Given their itinerary, their flights and a list of headlines, list the numbers of the headlines that could change their plans: closed roads, landslides, floods, severe weather, protests, closed parks or temples, cancelled festivals, airport or flight disruption, border incidents, disease outbreaks, severe smoke.
A headline counts when it could affect a place, road, region or flight on their route on a trip day. Check dates: an event on a day they are elsewhere does not count.
When unsure, include it: a later step reads each included headline closely, but a headline left out is never seen again. Most headlines are not relevant; an empty list is a normal answer.`;

export const TRIAGE_SYSTEM = `You screen news for two Israeli tourists on a private-driver trip in northern Thailand.
Given their itinerary, their flights and a few headlines that may matter, decide for each whether it could change their plans.
Mark a headline relevant only when it plausibly affects a place, road or flight on their route on a trip day.
"urgent" means they should act today or tomorrow; "warning" means worth planning around; "info" means good to know.
affectedDate is the first trip day it affects. Write titleHe and bodyHe in natural Hebrew. Return one entry per headline index.`;

export function triagePrompt(trip: Trip, today: string, articles: Article[]): string {
  const list = articles.map((a, i) => `${i}. [${a.domain}, ${a.seendate}] ${a.title}`).join("\n");
  return `Today is ${today}.\n\nItinerary, next days:\n${tripOutline(trip, today)}\n\nLater days and flights:\n${tripFixedPoints(trip, today)}\n\nHeadlines:\n${list}`;
}

/** The headlines a filter answer kept, in their original order. */
export function toFiltered(parsed: z.infer<typeof Filter> | null, articles: Article[]): Article[] {
  const keep = new Set(parsed?.relevant ?? []);
  return articles.filter((_, i) => keep.has(i));
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

export async function filterNews(env: Env, trip: Trip, today: string, articles: Article[]): Promise<Article[]> {
  if (!articles.length) return [];
  const response = await client(env).messages.parse({
    model: env.CLAUDE_FILTER_MODEL ?? env.CLAUDE_TRIAGE_MODEL,
    max_tokens: 1000,
    system: FILTER_SYSTEM,
    messages: [{ role: "user", content: triagePrompt(trip, today, articles) }],
    output_config: { format: zodOutputFormat(Filter) },
  });
  return toFiltered(response.parsed_output, articles);
}

export async function triageNews(env: Env, trip: Trip, today: string, articles: Article[]): Promise<NewsItem[]> {
  if (!articles.length) return [];
  const response = await client(env).messages.parse({
    model: env.CLAUDE_TRIAGE_MODEL,
    max_tokens: 4000,
    system: TRIAGE_SYSTEM,
    messages: [{ role: "user", content: triagePrompt(trip, today, articles) }],
    output_config: { format: zodOutputFormat(Triage) },
  });
  return toNewsItems(response.parsed_output, articles, today);
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
