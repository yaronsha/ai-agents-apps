import type { TripPrivate, TripState } from "@trip/shared";

const KEYS = {
  api: "trip.devApiUrl",
  token: "trip.token",
  state: "trip.lastState",
  private: "trip.private",
  pushPromptDismissed: "trip.pushPromptDismissedAt",
  /** Endpoint of the push subscription the server confirmed, so a half-done signup doesn't count. */
  pushEndpoint: "trip.pushEndpoint",
};

/** The cron saves state at least hourly; older than this means something stopped. */
const STALE_MS = 90 * 60_000;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode: settings just won't stick */
  }
}

// Older versions saved the worker's own address on the phone. The app now calls /api on its own
// address (the Pages Function passes it on), so the sign-in covers it; drop the old setting.
write("trip.apiUrl", null);

export const settings = {
  /** Empty means this site's own /api. Only the simulator points it elsewhere. */
  apiUrl: () => (read(KEYS.api) || "").replace(/\/$/, ""),
  token: () => read(KEYS.token) || "",
  setToken: (v: string) => write(KEYS.token, v.trim() || null),
  pushPromptDismissedAt: () => Number(read(KEYS.pushPromptDismissed)) || null,
  dismissPushPrompt: () => write(KEYS.pushPromptDismissed, String(Date.now())),
};

const SIGN_IN_KEY = "trip.signInAt";

/**
 * When the Cloudflare Access sign-in runs out, /api answers with a redirect to the login page,
 * which fetch cannot follow. Open /api/login as a page instead (at most once a minute, so a
 * broken setup can't loop); Access signs in and sends the browser back to the app.
 */
function signInAgain(): never {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(SIGN_IN_KEY) ?? 0);
    sessionStorage.setItem(SIGN_IN_KEY, String(Date.now()));
  } catch {
    /* no session storage: still try once */
  }
  if (Date.now() - last > 60_000) window.location.assign("/api/login");
  throw new Error("צריך להתחבר מחדש");
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const token = settings.token();
  const res = await fetch(`${settings.apiUrl()}${path}`, {
    ...init,
    redirect: "manual",
    headers: { "Content-Type": "application/json", ...(token ? { "X-Trip-Token": token } : {}), ...(init?.headers ?? {}) },
  });
  if (res.type === "opaqueredirect") signInAgain();
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `שגיאת שרת ${res.status}`);
  return body as T;
}

/** Live state from the worker; falls back to the last copy saved on the phone when offline. */
export async function loadState(): Promise<{ state: TripState | null; offline: boolean; stale: boolean; error?: string }> {
  try {
    const state = await call<TripState>("/api/state");
    write(KEYS.state, JSON.stringify(state));
    return { state, offline: false, stale: Date.now() - Date.parse(state.generatedAt) > STALE_MS };
  } catch (err) {
    const saved = read(KEYS.state);
    return { state: saved ? (JSON.parse(saved) as TripState) : null, offline: true, stale: true, error: (err as Error).message };
  }
}

/**
 * Hotels and flights are not in the app bundle; the worker sends them only to a signed-in
 * allowed email (or the access code), and the phone keeps a copy for offline use.
 */
export async function loadPrivate(): Promise<TripPrivate | null> {
  try {
    const priv = await call<TripPrivate>("/api/trip-private");
    write(KEYS.private, JSON.stringify(priv));
    return priv;
  } catch {
    return null;
  }
}

export function cachedPrivate(): TripPrivate | null {
  const saved = read(KEYS.private);
  try {
    return saved ? (JSON.parse(saved) as TripPrivate) : null;
  } catch {
    return null;
  }
}

export const replan = (date: string, problem: string) =>
  call<{ text: string }>("/api/replan", { method: "POST", body: JSON.stringify({ date, problem }) });

export const testPush = () => call<{ sent: number }>("/api/test-push", { method: "POST" });

export const previewAt = (at: string) => call<TripState>(`/api/run?at=${encodeURIComponent(at)}`, { method: "POST" });

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** iPadOS Safari reports a Mac user agent; a touch screen gives it away. */
function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function pushSupport(): "ok" | "no-sw" | "ios-not-installed" | "unsupported" {
  if (!("serviceWorker" in navigator)) return "no-sw";
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone;
  if (!("PushManager" in window)) return isIOS() && !standalone ? "ios-not-installed" : "unsupported";
  return "ok";
}

export interface ServerConfig {
  vapidPublicKey: string;
  /** "access": Cloudflare sign-in; "token": the shared access code (before Access is set up). */
  auth?: "access" | "token";
}

export const serverConfig = () => call<ServerConfig>("/api/config");

export async function enablePush(): Promise<number> {
  // Ask first, while still inside the tap: iOS drops the user gesture after a network round trip.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("לא אושרו התראות בדפדפן");
  const { vapidPublicKey } = await serverConfig();
  if (!vapidPublicKey) throw new Error("לשרת אין מפתח VAPID");
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) }));
  const res = await call<{ devices: number }>("/api/subscribe", { method: "POST", body: JSON.stringify(sub.toJSON()) });
  write(KEYS.pushEndpoint, sub.endpoint);
  return res.devices;
}

/** True only when this device has a subscription and the server confirmed it. */
export async function pushEnabled(): Promise<boolean> {
  if (pushSupport() !== "ok") return false;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return Boolean(sub && sub.endpoint === read(KEYS.pushEndpoint));
}
