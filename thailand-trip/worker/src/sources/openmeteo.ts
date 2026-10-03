// Open-Meteo: free, no key, non-commercial use. https://open-meteo.com/en/docs
import type { HourlyAir, HourlyForecast, LatLng } from "@trip/shared";
import { getJson } from "./http";

interface Point extends LatLng {
  id: string;
}

type OneOrMany<T> = T | T[];
const many = <T>(x: OneOrMany<T>): T[] => (Array.isArray(x) ? x : [x]);
const coords = (points: Point[]) =>
  `latitude=${points.map((p) => p.lat.toFixed(4)).join(",")}&longitude=${points.map((p) => p.lng.toFixed(4)).join(",")}`;

interface ForecastResponse {
  hourly: {
    time: string[];
    precipitation_probability: Array<number | null>;
    precipitation: Array<number | null>;
    weather_code: Array<number | null>;
    temperature_2m: Array<number | null>;
    cloud_cover_low: Array<number | null>;
    cloud_cover_high: Array<number | null>;
  };
}

export async function fetchForecasts(points: Point[], startDate: string, endDate: string): Promise<Record<string, HourlyForecast>> {
  if (!points.length) return {};
  const url =
    `https://api.open-meteo.com/v1/forecast?${coords(points)}` +
    "&hourly=precipitation_probability,precipitation,weather_code,temperature_2m,cloud_cover_low,cloud_cover_high" +
    `&timezone=Asia%2FBangkok&start_date=${startDate}&end_date=${endDate}`;
  const res = many(await getJson<OneOrMany<ForecastResponse>>(url));
  const out: Record<string, HourlyForecast> = {};
  res.forEach((r, i) => {
    out[points[i].id] = {
      time: r.hourly.time,
      precipProb: r.hourly.precipitation_probability,
      precip: r.hourly.precipitation,
      code: r.hourly.weather_code,
      temp: r.hourly.temperature_2m,
      lowCloud: r.hourly.cloud_cover_low,
      highCloud: r.hourly.cloud_cover_high,
    };
  });
  return out;
}

interface AirResponse {
  hourly: { time: string[]; pm2_5: Array<number | null> };
}

/** Air quality forecasts reach about 5 days ahead. */
export async function fetchAir(points: Point[], startDate: string, endDate: string): Promise<Record<string, HourlyAir>> {
  if (!points.length) return {};
  const url =
    `https://air-quality-api.open-meteo.com/v1/air-quality?${coords(points)}` +
    `&hourly=pm2_5&timezone=Asia%2FBangkok&start_date=${startDate}&end_date=${endDate}`;
  const res = many(await getJson<OneOrMany<AirResponse>>(url));
  const out: Record<string, HourlyAir> = {};
  res.forEach((r, i) => {
    out[points[i].id] = { time: r.hourly.time, pm25: r.hourly.pm2_5 };
  });
  return out;
}
