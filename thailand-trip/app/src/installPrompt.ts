import { useState, useSyncExternalStore } from "react";

/** Chrome's install event; not in the DOM typings yet. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** After "not now", the install card stays away this long. */
export const INSTALL_SNOOZE_MS = 7 * 24 * 60 * 60_000;
const DISMISS_KEY = "trip.installPromptDismissedAt";

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/**
 * Only Chrome on Android gets the install button. Chrome fires the event once, early, often
 * before React has drawn anything, so it is caught here when the module loads.
 */
export const isAndroid = (ua: string) => /Android/i.test(ua);

if (typeof window !== "undefined" && isAndroid(navigator.userAgent)) {
  window.addEventListener("beforeinstallprompt", (e) => {
    // Keep Chrome's own mini-infobar away; the card offers it instead.
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

export function showInstallCard(o: { available: boolean; dismissedAt: number | null; now: number }): boolean {
  if (!o.available) return false;
  return o.dismissedAt === null || o.now - o.dismissedAt >= INSTALL_SNOOZE_MS;
}

function dismissedAt(): number | null {
  try {
    return Number(localStorage.getItem(DISMISS_KEY)) || null;
  } catch {
    return null;
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Whether the install card should show now, plus its two actions. */
export function useInstallPrompt() {
  const available = useSyncExternalStore(subscribe, () => deferred !== null);
  const [dismissed, setDismissed] = useState(dismissedAt);
  const show = showInstallCard({ available, dismissedAt: dismissed, now: Date.now() });

  const snooze = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* private mode: the card just comes back next time */
    }
    setDismissed(Date.now());
  };

  const install = async () => {
    const e = deferred;
    if (!e) return;
    // Chrome allows prompt() once per event; the next one comes on a later page load.
    deferred = null;
    notify();
    try {
      await e.prompt();
      // Cancelling Chrome's dialog counts as "not now", or the card would return every launch.
      if ((await e.userChoice).outcome === "dismissed") snooze();
    } catch {
      /* Chrome refused to show the dialog; the card comes back with the next event */
    }
  };

  return { show, install, dismiss: snooze };
}
