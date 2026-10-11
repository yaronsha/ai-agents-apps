import type { TripAlert, TripState } from "@trip/shared";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const record = <T>(v: unknown) => (isObject(v) ? (v as Record<string, T>) : {});

/**
 * Checks a state from the server or from the phone's saved copy. A copy saved by an older version
 * can lack newer fields (e.g. `sources`); those become empty so no screen crashes on them.
 * Anything that is not a state at all gives null.
 */
export function toTripState(raw: unknown): TripState | null {
  if (!isObject(raw) || typeof raw.generatedAt !== "string" || Number.isNaN(Date.parse(raw.generatedAt)) || !Array.isArray(raw.alerts)) return null;
  return {
    generatedAt: raw.generatedAt,
    alerts: raw.alerts.filter((a): a is TripAlert => isObject(a) && typeof a.date === "string" && typeof a.category === "string"),
    dayStatus: record(raw.dayStatus),
    forecasts: record(raw.forecasts),
    sources: record(raw.sources),
  };
}

/** Parses the saved copy; a corrupt or foreign value gives null instead of throwing. */
export function parseTripState(saved: string | null): TripState | null {
  if (!saved) return null;
  try {
    return toTripState(JSON.parse(saved));
  } catch {
    return null;
  }
}
