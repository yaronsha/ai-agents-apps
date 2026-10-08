import type { DayStatus, Severity } from "@trip/shared";

const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return `יום ${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()}.${d.getUTCMonth() + 1}`;
}

const WEEKDAYS_SHORT = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

/** "ב׳" for a Monday: the short weekday letter used on the day strip. */
export function weekdayShort(date: string): string {
  return WEEKDAYS_SHORT[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

/** Whole days between two "YYYY-MM-DD" dates. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

export function shortDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}`;
}

export const statusText: Record<DayStatus, string> = {
  green: "הכול לפי התוכנית",
  yellow: "כדאי לשים לב",
  red: "צריך לשנות משהו",
};

export const severityText: Record<Severity, string> = {
  urgent: "דחוף",
  warning: "אזהרה",
  info: "לידיעה",
};

export function ago(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "עכשיו";
  if (min < 60) return `לפני ${min} דק'`;
  const h = Math.round(min / 60);
  if (h < 48) return `לפני ${h} שע'`;
  return `לפני ${Math.round(h / 24)} ימים`;
}
