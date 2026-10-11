export interface Env {
  TRIP_KV: KVNamespace;
  /** Shared access code; used only while Cloudflare Access is not set up. */
  APP_TOKEN: string;
  /** Cloudflare Access team domain, e.g. "myteam.cloudflareaccess.com". With ACCESS_AUD, turns on sign-in. */
  ACCESS_TEAM_DOMAIN?: string;
  /** "Application Audience (AUD) Tag" of the Access application in front of the app. */
  ACCESS_AUD?: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_JWK: string;
  VAPID_CONTACT: string;
  /** "claude" (default) or "openai": which model runs news triage and re-plan. */
  AI_PROVIDER?: string;
  CLAUDE_TRIAGE_MODEL: string;
  CLAUDE_REPLAN_MODEL: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_TRIAGE_MODEL: string;
  OPENAI_REPLAN_MODEL: string;
  OPENAI_API_KEY?: string;
  GOOGLE_MAPS_KEY?: string;
  RAPIDAPI_KEY?: string;
  /**
   * Optional outside heartbeat, e.g. a healthchecks.io ping URL ("https://hc-ping.com/<uuid>").
   * Pinged after every cron run, with "/fail" when the run threw or pushes could not be sent,
   * so someone gets an email when the cron stops running or stops reaching the phones.
   */
  HEARTBEAT_URL?: string;
  /** News shadow mode (worker/src/shadow.ts): "on" (default) logs candidate news sources hourly; "off" stops it. */
  SHADOW_NEWS?: string;
  /** "on" also triages each shadow source's past-day headlines once a day (about 2 AI calls). Default "off". */
  SHADOW_AI?: string;
}
