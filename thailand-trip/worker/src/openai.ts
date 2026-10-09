import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { NewsItem, Trip, TripAlert } from "@trip/shared";
import type { Article } from "./sources/gdelt";
import type { Env } from "./env";
import { ADVISORY_SYSTEM, REPLAN_REFUSED, REPLAN_SYSTEM, replanPrompt, toNewsItems, Triage, TRIAGE_SYSTEM, triagePrompt } from "./claude";

// The same prompts and answer shape as ./claude, sent to OpenAI's Responses API.

function client(env: Env): OpenAI {
  return new OpenAI({ apiKey: env.OPENAI_API_KEY });
}

export async function triageNews(env: Env, trip: Trip, today: string, articles: Article[]): Promise<NewsItem[]> {
  if (!articles.length) return [];
  // Reasoning tokens count toward max_output_tokens, so keep effort low and leave room for the answer.
  const response = await client(env).responses.create({
    model: env.OPENAI_TRIAGE_MODEL,
    max_output_tokens: 16000,
    reasoning: { effort: "low" },
    instructions: TRIAGE_SYSTEM,
    input: triagePrompt(trip, today, articles),
    text: { format: zodTextFormat(Triage, "triage") },
  });
  if (response.status === "incomplete") throw new Error(`OpenAI triage incomplete: ${response.incomplete_details?.reason ?? "unknown"}`);
  return toNewsItems(Triage.parse(JSON.parse(response.output_text)), articles, today);
}

export async function translateAdvisory(env: Env, text: string): Promise<string> {
  // It runs before the flight check in the same cron run, and the English note is a fine fallback.
  const response = await client(env).responses.create(
    { model: env.OPENAI_TRIAGE_MODEL, max_output_tokens: 4000, reasoning: { effort: "low" }, instructions: ADVISORY_SYSTEM, input: text },
    { timeout: 15_000, maxRetries: 1 },
  );
  return response.output_text.trim();
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
