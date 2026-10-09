export interface Env {
  TRIP_KV: KVNamespace;
  APP_TOKEN: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_JWK: string;
  VAPID_CONTACT: string;
  /** "claude" (default) or "openai": which model runs news triage and re-plan. */
  AI_PROVIDER?: string;
  /** The cheap first step of news triage; the triage model when unset. */
  CLAUDE_FILTER_MODEL?: string;
  CLAUDE_TRIAGE_MODEL: string;
  CLAUDE_REPLAN_MODEL: string;
  ANTHROPIC_API_KEY?: string;
  /** The cheap first step of news triage; the triage model when unset. */
  OPENAI_FILTER_MODEL?: string;
  OPENAI_TRIAGE_MODEL: string;
  OPENAI_REPLAN_MODEL: string;
  OPENAI_API_KEY?: string;
  GOOGLE_MAPS_KEY?: string;
  RAPIDAPI_KEY?: string;
  /** News shadow mode (worker/src/shadow.ts): "on" (default) logs candidate news sources hourly; "off" stops it. */
  SHADOW_NEWS?: string;
  /** "on" also triages each shadow source's past-day headlines once a day (about 2 AI calls). Default "off". */
  SHADOW_AI?: string;
}
