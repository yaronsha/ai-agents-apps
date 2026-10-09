// Google Routes API, traffic-aware (billed as Compute Routes Pro). Needs GOOGLE_MAPS_KEY.
import type { LatLng, RouteReading } from "@trip/shared";

const waypoint = (p: LatLng) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
const seconds = (s: string) => Number(s.replace("s", ""));

export async function fetchDriveTime(key: string, from: LatLng, to: LatLng, now: Date): Promise<RouteReading> {
  const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "routes.duration,routes.staticDuration",
    },
    body: JSON.stringify({
      origin: waypoint(from),
      destination: waypoint(to),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      departureTime: new Date(now.getTime() + 60_000).toISOString(),
    }),
  });
  if (!res.ok) {
    // Google explains a refusal (API disabled, key restricted) in error.message; keep it for the note.
    const why = await res.json().then((b) => (b as { error?: { message?: string } }).error?.message, () => undefined);
    throw new Error(`routes ${res.status}${why ? `: ${why.slice(0, 160)}` : ""}`);
  }
  const body = (await res.json()) as { routes?: Array<{ duration: string; staticDuration: string }> };
  const r = body.routes?.[0];
  if (!r) return { noRoute: true };
  return { durationSec: seconds(r.duration), staticSec: seconds(r.staticDuration) };
}
