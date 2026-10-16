import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { NewsItem, Trip, TripAlert } from "@trip/shared";
import type { Article } from "./sources/gdelt";
import type { Env } from "./env";
import { ADVISORY_SYSTEM, REPLAN_REFUSED, REPLAN_SYSTEM, replanPrompt, toNewsItems, Triage, TRIAGE_REQUEST, TRIAGE_SYSTEM, triagePrompt } from "./prompts";

function client(env: Env): Anthropic {
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

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

/** The advisory change note in Hebrew (the triage model is enough for a short translation). */
export async function translateAdvisory(env: Env, text: string): Promise<string> {
  // It runs before the flight check in the same cron run, and the English note is a fine fallback.
  const response = await client(env).messages.create(
    { model: env.CLAUDE_TRIAGE_MODEL, max_tokens: 2000, system: ADVISORY_SYSTEM, messages: [{ role: "user", content: text }] },
    { timeout: 15_000, maxRetries: 1 },
  );
  return response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
}

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
