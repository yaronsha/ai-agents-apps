// USGS feed of M4.5+ earthquakes in the past day. Free, no key.
import type { Quake } from "@trip/shared";
import { getJson } from "./http";

interface Feed {
  features: Array<{
    id: string;
    properties: { mag: number; place: string; time: number; url: string };
    geometry: { coordinates: [number, number, number] };
  }>;
}

export async function fetchQuakes(): Promise<Quake[]> {
  const feed = await getJson<Feed>("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson");
  return feed.features.map((f) => ({
    id: f.id,
    mag: f.properties.mag,
    place: f.properties.place,
    timeMs: f.properties.time,
    url: f.properties.url,
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }));
}
