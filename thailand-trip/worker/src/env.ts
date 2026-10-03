export interface Env {
  TRIP_KV: KVNamespace;
  APP_TOKEN: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_JWK: string;
  VAPID_CONTACT: string;
  CLAUDE_TRIAGE_MODEL: string;
  CLAUDE_REPLAN_MODEL: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_MAPS_KEY?: string;
  RAPIDAPI_KEY?: string;
}
