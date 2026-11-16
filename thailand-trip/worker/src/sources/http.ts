/** How long one outside request may take before the cron gives up on it. */
export const FETCH_TIMEOUT_MS = 10_000;

/**
 * fetch with a timeout, so one hung source can't hold up the rest of the cron run (the roads
 * and flights checks come after news). A caller's own signal still works alongside it.
 */
export function fetchWithTimeout(url: string, init: RequestInit = {}, ms = FETCH_TIMEOUT_MS): Promise<Response> {
  const timeout = AbortSignal.timeout(ms);
  return fetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
}

export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithTimeout(url, init);
  const host = new URL(url).host;
  const text = await res.text();
  if (!res.ok) {
    // Open-Meteo and others say why in a JSON "reason"; keep it so the source note explains itself.
    let reason = "";
    try {
      reason = String((JSON.parse(text) as { reason?: unknown }).reason ?? "");
    } catch {
      // not JSON
    }
    throw new Error(`${host} ${res.status}${reason ? `: ${reason.slice(0, 160)}` : ""}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    // Some APIs (GDELT) answer 200 with a plain-text explanation; keep it for the source note.
    throw new Error(`${host}: ${text.slice(0, 160).trim()}`);
  }
}

/** For calls that take no signal: the timeout races them instead of aborting the request. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  const signal = AbortSignal.timeout(ms);
  return Promise.race([
    p,
    new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error(`timeout after ${ms / 1000} s`)))),
  ]);
}
