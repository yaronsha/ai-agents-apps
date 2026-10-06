export const TH_OFFSET_HOURS = 7;
const HOUR = 3_600_000;

/** "2026-11-23T09:00" in Thailand time -> Date. */
export function thLocal(local: string): Date {
  return new Date(`${local}:00+07:00`);
}

/** Local time at an arbitrary UTC offset -> Date. */
export function localAt(local: string, utcOffsetHours: number): Date {
  const sign = utcOffsetHours >= 0 ? "+" : "-";
  const hh = String(Math.abs(utcOffsetHours)).padStart(2, "0");
  return new Date(`${local}:00${sign}${hh}:00`);
}

/** Date -> parts of the wall clock in Thailand. */
export function thParts(d: Date): { date: string; hour: number; minute: number } {
  const shifted = new Date(d.getTime() + TH_OFFSET_HOURS * HOUR);
  const iso = shifted.toISOString();
  return { date: iso.slice(0, 10), hour: shifted.getUTCHours(), minute: shifted.getUTCMinutes() };
}

export function thDate(d: Date): string {
  return thParts(d).date;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addHours(d: Date, hours: number): Date {
  return new Date(d.getTime() + hours * HOUR);
}

/** "HH:mm" of a local time string. */
export function hhmm(local: string): string {
  return local.slice(11, 16);
}

export const QUIET_START_HOUR = 22;
export const QUIET_END_HOUR = 6;
export const DIGEST_HOUR = 20;

export function isQuietHour(d: Date): boolean {
  const { hour } = thParts(d);
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

/** Moves a time that falls in quiet hours to 06:00 Thailand time of the following morning. */
export function deferPastQuiet(d: Date): Date {
  if (!isQuietHour(d)) return d;
  const { date, hour } = thParts(d);
  const morningDate = hour >= QUIET_START_HOUR ? addDays(date, 1) : date;
  return thLocal(`${morningDate}T0${QUIET_END_HOUR}:00`);
}

/** 20:00 Thailand time on the evening before `date`. */
export function eveningBefore(date: string): Date {
  return thLocal(`${addDays(date, -1)}T${DIGEST_HOUR}:00`);
}
