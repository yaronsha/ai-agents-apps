import { dayOf, googleMapsDirections, hhmm, placeOf, type Drive, type Stop, type StopForecast } from "@trip/shared";
import { useTrip } from "../tripContext";
import type { Live } from "../App";
import { ago, dayLabel, statusText } from "../format";
import { Icon } from "../icons";
import { InstallPrompt } from "./InstallPrompt";
import { PushPrompt } from "./PushPrompt";

function Forecast({ f }: { f?: StopForecast }) {
  if (!f || f.tempMax === null) return null;
  const rain = f.maxRainProb ?? 0;
  return (
    <span className={`forecast ${f.thunder || rain >= 70 ? "wet" : ""}`}>
      {f.thunder ? "⛈ " : rain >= 40 ? "🌧 " : "☀ "}
      {Math.round(f.tempMin ?? f.tempMax)}°–{Math.round(f.tempMax)}°{rain > 0 ? ` · ${rain}%` : ""}
      {f.pm25Max !== null && f.pm25Max > 50 ? ` · PM2.5 ${Math.round(f.pm25Max)}` : ""}
    </span>
  );
}

function StopRow({ stop, f }: { stop: Stop; f?: StopForecast }) {
  return (
    <li className="tl-row">
      <time className="time">{hhmm(stop.start)}</time>
      <div className="tl-body">
        <div className="stop-name">{stop.nameHe}</div>
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

export function Today({ date, live, refresh, openAlerts }: { date: string; live: Live; refresh: () => void; openAlerts: () => void }) {
  const trip = useTrip();
  const day = dayOf(trip, date)!;
  const status = live.state?.dayStatus[date];
  const lodging = day.lodgingId ? placeOf(trip, `lodging:${day.lodgingId}`) : undefined;
  const dayAlerts = live.state?.alerts.filter((a) => a.date === date && a.category !== "reminder") ?? [];
  const dayNumber = trip.days.findIndex((d) => d.date === date) + 1;

  // Stops and drives in the order they happen (local time strings sort as text); a drive
  // that leaves when a stop starts goes first.
  const rows = [
    ...day.drives.map((d) => ({ at: d.departAt, el: <DriveRow key={d.id} drive={d} to={placeOf(trip, d.toId)?.nameHe} /> })),
    ...day.stops.map((s) => ({ at: s.start, el: <StopRow key={s.id} stop={s} f={live.state?.forecasts[s.id]} /> })),
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
      {(live.offline || live.stale) && (
        <button className="offline" onClick={refresh}>
          {live.offline ? `מוצג מידע שמור. ${live.error ?? ""}` : "המידע מהשרת לא התעדכן לאחרונה."} עודכן {live.state ? ago(live.state.generatedAt) : "אף פעם"} · לחצו לרענון
        </button>
      )}
      <InstallPrompt />
      <PushPrompt />

      <h2 className="section-title">התוכנית</h2>
      <ol className="timeline">{rows.map((r) => r.el)}</ol>

      {day.reminders.length > 0 && (
        <section className="card">
          <h2>תזכורות</h2>
          {day.reminders.map((r) => (
            <p key={r.id}>
              <span className="time-inline">{hhmm(r.at)}</span> {r.textHe}
            </p>
          ))}
        </section>
      )}

      {lodging && (
        <section className="card lodging">
          <Icon name="bed" />
          <div>
            <h2>לינה הלילה</h2>
            <p>{lodging.nameHe}</p>
          </div>
          <a className="btn" href={googleMapsDirections(lodging)} target="_blank" rel="noreferrer">
            ניווט
          </a>
        </section>
      )}

      <details className="card">
        <summary>תוכנית ב' ליום הזה</summary>
        <ul>
          {day.planB.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </details>
    </>
  );
}
