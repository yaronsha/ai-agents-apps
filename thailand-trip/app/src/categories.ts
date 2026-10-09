import type { AlertCategory, Severity, TripAlert } from "@trip/shared";
import type { IconName } from "./icons";

export const CATEGORY_HE: Record<AlertCategory, string> = {
  weather: "מזג אוויר",
  air: "איכות אוויר",
  cold: "קור",
  clouds: "ים עננים",
  quake: "רעידת אדמה",
  road: "כבישים",
  flight: "טיסה",
  news: "חדשות",
  advisory: "אזהרת מסע",
  reminder: "תזכורת",
};

/** The four things a traveller checks each morning; every alert category rolls up into one. */
export const GROUPS: Array<{ id: string; labelHe: string; icon: IconName; okHe: string; categories: AlertCategory[] }> = [
  { id: "weather", labelHe: "מזג אוויר", icon: "weather", okHe: "אין גשם או קור חריגים", categories: ["weather", "cold", "clouds"] },
  { id: "air", labelHe: "איכות אוויר", icon: "air", okHe: "אין זיהום חריג", categories: ["air"] },
  { id: "road", labelHe: "דרכים וטיסות", icon: "road", okHe: "אין עיכובים ידועים", categories: ["road", "flight"] },
  { id: "safety", labelHe: "ביטחון", icon: "safety", okHe: "שקט באזור", categories: ["quake", "news", "advisory"] },
];

const RANK: Record<Severity, number> = { info: 0, warning: 1, urgent: 2 };

/**
 * The most severe alert of the group that day, or undefined when it is all clear. Info alerts
 * count too: a smoke notice must not leave the air tile saying there is no pollution.
 */
export function worstOf(alerts: TripAlert[], categories: AlertCategory[]): TripAlert | undefined {
  return alerts.filter((a) => categories.includes(a.category)).sort((a, b) => RANK[b.severity] - RANK[a.severity])[0];
}
