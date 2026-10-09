/** After a dismiss, the home-screen push prompt stays away this long. */
export const PUSH_PROMPT_SNOOZE_MS = 7 * 24 * 60 * 60_000;

export type PushPromptMode = "enable" | "install" | "blocked" | null;

/**
 * What the home-screen push prompt should show, or null for nothing. iOS allows Web Push
 * only from an installed PWA, so there it explains Add to Home Screen instead.
 */
export function pushPromptMode(o: {
  support: "ok" | "no-sw" | "ios-not-installed" | "unsupported";
  permission: NotificationPermission | null;
  enabled: boolean;
  dismissedAt: number | null;
  now: number;
}): PushPromptMode {
  if (o.enabled) return null;
  if (o.dismissedAt !== null && o.now - o.dismissedAt < PUSH_PROMPT_SNOOZE_MS) return null;
  if (o.support === "ios-not-installed") return "install";
  if (o.support !== "ok") return null;
  return o.permission === "denied" ? "blocked" : "enable";
}
