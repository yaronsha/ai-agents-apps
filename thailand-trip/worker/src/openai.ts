import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { NewsItem, Trip, TripAlert } from "@trip/shared";
import type { Article } from "./sources/gdelt";
import type { Env } from "./env";
import { REPLAN_REFUSED, REPLAN_SYSTEM, replanPrompt, toNewsItems, Triage, TRIAGE_SYSTEM, triagePrompt } from "./claude";

// The same prompts and answer shape as ./claude, sent to OpenAI's Responses API.

function client(env: Env): OpenAI {
  return new OpenAI({ apiKey: env.OPENAI_API_KEY });
}

export async function triageNews(env: Env, trip: Trip, today: string, articles: Article[]): Promise<NewsItem[]> {
  if (!articles.length) return [];
  const response = await client(env).responses.parse({
    model: env.OPENAI_TRIAGE_MODEL,
    max_output_tokens: 4000,
    instructions: TRIAGE_SYSTEM,
    input: triagePrompt(trip, today, articles),
    text: { format: zodTextFormat(Triage, "triage") },
  });
  return toNewsItems(response.output_parsed, articles, today);
}

export async function replan(env: Env, trip: Trip, date: string, alerts: TripAlert[], problem: string): Promise<string> {
  const input = replanPrompt(trip, date, alerts, problem);
  const response = await client(env).responses.create({
    model: env.OPENAI_REPLAN_MODEL,
    max_output_tokens: 16000,
    reasoning: { effort: "medium" },
    instructions: REPLAN_SYSTEM,
    input,
  });
  return response.output_text.trim() || REPLAN_REFUSED;
}
