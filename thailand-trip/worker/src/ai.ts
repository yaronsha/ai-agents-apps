import type { NewsItem, PlaceNotice, Trip, TripAlert } from "@trip/shared";
import type { Article } from "./sources/gdelt";
import type { Env } from "./env";
import * as claude from "./claude";
import type { PlaceTarget } from "./prompts";
import * as openai from "./openai";

export type AiProvider = "claude" | "openai";

/** The provider AI_PROVIDER picks, or null when its key isn't set (news triage and re-plan then stay off). */
export function aiProvider(env: Env): AiProvider | null {
  if (env.AI_PROVIDER?.toLowerCase() === "openai") return env.OPENAI_API_KEY ? "openai" : null;
  return env.ANTHROPIC_API_KEY ? "claude" : null;
}

const impl = (env: Env) => (aiProvider(env) === "openai" ? openai : claude);

export function triageNews(env: Env, trip: Trip, today: string, articles: Article[]): Promise<NewsItem[]> {
  return impl(env).triageNews(env, trip, today, articles);
}

export function translateAdvisory(env: Env, text: string): Promise<string> {
  return impl(env).translateAdvisory(env, text);
}

export function replan(env: Env, trip: Trip, date: string, alerts: TripAlert[], problem: string): Promise<string> {
  return impl(env).replan(env, trip, date, alerts, problem);
}

export function checkPlaces(env: Env, today: string, targets: PlaceTarget[]): Promise<PlaceNotice[]> {
  return impl(env).checkPlaces(env, today, targets);
}
