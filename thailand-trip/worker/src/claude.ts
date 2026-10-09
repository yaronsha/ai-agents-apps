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

export const ADVISORY_SYSTEM = `Translate this change note from the UK government's travel advice for Thailand into short, natural Hebrew for two Israeli tourists.
Keep place names in English letters. Reply with the Hebrew text only.`;

/** The advisory change note in Hebrew (the triage model is enough for a short translation). */
export async function translateAdvisory(env: Env, text: string): Promise<string> {
  const response = await client(env).messages.create({
    model: env.CLAUDE_TRIAGE_MODEL,
    max_tokens: 2000,
    system: ADVISORY_SYSTEM,
    messages: [{ role: "user", content: text }],
  });
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
