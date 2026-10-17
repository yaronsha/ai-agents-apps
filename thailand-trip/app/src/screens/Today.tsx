import { useState } from "react";
import { dayOrDefault, googleMapsDirections, hhmm, placeInfo, placeOf, thDate, type Drive, type LatLng, type Lodging, type Reminder, type Stop, type StopForecast } from "@trip/shared";
import { useTrip } from "../tripContext";
import type { Live } from "../live";
import { ago, dayLabel, shortDay, statusText } from "../format";
import { Icon } from "../icons";
import { useInstallPrompt } from "../installPrompt";
import { InstallPrompt } from "./InstallPrompt";
import { PushPrompt } from "./PushPrompt";
import { LodgingSheet, PlanBSheet, StopSheet } from "./Sheets";

function Forecast({ f }: { f?: StopForecast }) {
  if (!f || f.tempMax === null) return null;
  const rain = f.maxRainProb ?? 0;
  const lo = Math.round(f.tempMin ?? f.tempMax);
  const hi = Math.round(f.tempMax);
  return (
    <span className={`forecast ${f.thunder || rain >= 70 ? "wet" : ""}`}>
      {f.thunder ? "⛈ " : rain >= 40 ? "🌧 " : rain >= 20 ? "⛅ " : "☀ "}
      {/* Low to high, left to right, also inside Hebrew text. */}
      <bdi dir="ltr">{lo === hi ? `${hi}°` : `${lo}°–${hi}°`}</bdi>
      {rain >= 20 ? ` · גשם ${rain}%` : ""}
      {f.pm25Max !== null && f.pm25Max > 50 ? ` · PM2.5 ${Math.round(f.pm25Max)}` : ""}
    </span>
  );
}

function StopRow({ stop, f, open }: { stop: Stop; f?: StopForecast; open: () => void }) {
  const info = placeInfo(stop.id);
  return (
    <li className="tl-row">
      <time className="time">{hhmm(stop.start)}</time>
      <div className="tl-body">
        <button className="stop-name" onClick={open}>
          {stop.nameHe}
          <Icon name="chevron" size={16} />
        </button>
        {info && <div className="stop-teaser">{info.teaserHe}</div>}
        <div className="stop-meta">
          <Forecast f={f} />
          <a className="nav-link" href={googleMapsDirections(stop)} target="_blank" rel="noreferrer">
            <Icon name="nav" size={14} />
            ניווט
          </a>
        </div>
        {stop.noteHe && <div className="note">{stop.noteHe}</div>}
      </div>
    </li>
  );
}

function DriveRow({ drive, to }: { drive: Drive; to?: string }) {
  return (
    <li className="tl-row drive">
      <time className="time">{hhmm(drive.departAt)}</time>
      <div className="tl-body">
        <Icon name="van" size={16} />
        <span>{to ? `נסיעה אל ${to}` : "יציאה עם הוואן"}</span>
      </div>
    </li>
  );
}

/** Where we sleep, as the last row of the day. */
function LodgingRow({ lodging, open }: { lodging: Lodging; open: () => void }) {
  return (
    <li className="tl-row drive stay">
      <span className="time">לילה</span>
      <div className="tl-body">
        <Icon name="bed" size={16} />
        <button className="stop-name" onClick={open}>
          <span>
            <span className="sr-only">לינה: </span>
            {lodging.name}
          </span>
          <Icon name="chevron" size={16} />
        </button>
      </div>
    </li>
  );
}

/** An evening reminder: after the day's last stop, so no stop sheet carries it. */
function ReminderRow({ reminder }: { reminder: Reminder }) {
  return (
    <li className="tl-row drive reminder">
      <time className="time">{hhmm(reminder.at)}</time>
      <div className="tl-body">
        <Icon name="alerts" size={16} />
        <span>
          <span className="sr-only">תזכורת: </span>
          {reminder.textHe}
        </span>
      </div>
    </li>
  );
}

/** The day's reminders that fall after the previous stop starts and no later than this one. */
export function remindersBefore(stops: Stop[], reminders: Reminder[], stop: Stop): Reminder[] {
  const prev = stops.filter((s) => s.start < stop.start).at(-1)?.start ?? "";
  return reminders.filter((r) => r.at > prev && r.at <= stop.start);
}

/** Reminders after the day's last stop starts: no stop sheet shows them. */
export function eveningReminders(stops: Stop[], reminders: Reminder[]): Reminder[] {
  const last = stops.reduce((m, s) => (s.start > m ? s.start : m), "");
  return reminders.filter((r) => r.at > last);
}

type Open = { kind: "stop"; stop: Stop } | { kind: "lodging"; lodging: Lodging } | { kind: "planB" } | null;

export function Today({
  date,
  live,
  refresh,
  openAlerts,
  openMap,
  openReplan,
}: {
  date: string;
  live: Live;
  refresh: () => void;
  openAlerts: () => void;
  /** Shows the place on the map (the map tab on a phone; the map beside the plan on a computer). */
  openMap: (at: LatLng) => void;
  openReplan: () => void;
}) {
  const trip = useTrip();
  const installCard = useInstallPrompt();
  const [open, setOpen] = useState<Open>(null);
  const day = dayOrDefault(trip, date);
  const status = live.state?.dayStatus[date];
  const lodging = day.lodgingId ? trip.lodgings.find((l) => l.id === day.lodgingId) : undefined;
  const dayAlerts = live.state?.alerts.filter((a) => a.date === date && a.category !== "reminder") ?? [];
  const dayNumber = trip.days.findIndex((d) => d.date === date) + 1;
  // On a day with something to watch, Plan B moves up under the status bar; otherwise it is a quiet link.
  const troubled = status === "yellow" || status === "red";
  const close = () => setOpen(null);
  const evening = eveningReminders(day.stops, day.reminders);
  const showOnMap = (at: LatLng) => () => {
    close();
    openMap(at);
  };

  // Stops and drives in the order they happen (local time strings sort as text); a drive
  // that leaves when a stop starts goes first.
  const rows = [
    ...day.drives.map((d) => ({ at: d.departAt, el: <DriveRow key={d.id} drive={d} to={placeOf(trip, d.toId)?.nameHe} /> })),
    ...day.stops.map((s) => ({
      at: s.start,
      el: <StopRow key={s.id} stop={s} f={live.state?.forecasts[s.id]} open={() => setOpen({ kind: "stop", stop: s })} />,
    })),
    ...evening.map((r) => ({ at: r.at, el: <ReminderRow key={r.id} reminder={r} /> })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <>
      <header className="day-head">
        <div className="eyebrow">
          יום {dayNumber} · {dayLabel(date)}
        </div>
        <h1>{day.titleHe}</h1>
      </header>

      <button className={`statusbar ${status ?? "none"}`} onClick={openAlerts}>
        <span className="status-main">
          <i className="status-dot" />
          <strong>{status ? statusText[status] : live.loading ? "בודק..." : "אין נתונים חיים"}</strong>
        </span>
        <span>{dayAlerts.length ? `${dayAlerts.length} התראות ›` : live.state ? `עודכן ${ago(live.state.generatedAt)}` : ""}</span>
      </button>
      {troubled && day.planB.length > 0 && (
        <button className={`planb-cta ${status}`} onClick={() => setOpen({ kind: "planB" })}>
          <span>תוכנית ב' מוכנה {date === thDate(new Date()) ? "להיום" : `ל-${shortDay(date)}`}</span>
          <Icon name="chevron" size={18} />
        </button>
      )}
      {(live.offline || live.stale) && (
        <button className="offline" onClick={refresh}>
          <Icon name="offline" size={16} />
          <span>
          {live.offline ? `מוצג מידע שמור. ${live.error ?? ""}` : "המידע מהשרת לא התעדכן לאחרונה."} עודכן {live.state ? ago(live.state.generatedAt) : "אף פעם"} · לחצו לרענון
          </span>
        </button>
      )}
      {/* One card at a time: install first, then push (better asked from the installed app). */}
      {installCard.show ? <InstallPrompt {...installCard} /> : <PushPrompt />}

      <h2 className="section-title">התוכנית</h2>
      <ol className="timeline">
        {rows.map((r) => r.el)}
        {lodging && <LodgingRow lodging={lodging} open={() => setOpen({ kind: "lodging", lodging })} />}
      </ol>

      {!troubled && day.planB.length > 0 && (
        <button className="link planb-link" onClick={() => setOpen({ kind: "planB" })}>
          תוכנית ב' ליום הזה
        </button>
      )}

      {open?.kind === "stop" && (
        <StopSheet stop={open.stop} date={date} reminders={remindersBefore(day.stops, day.reminders, open.stop)} onClose={close} onMap={showOnMap(open.stop)} />
      )}
      {open?.kind === "lodging" && <LodgingSheet lodging={open.lodging} reminders={evening} onClose={close} onMap={showOnMap(open.lodging)} />}
      {open?.kind === "planB" && <PlanBSheet date={date} planB={day.planB} onClose={close} onReplan={openReplan} />}
    </>
  );
}
