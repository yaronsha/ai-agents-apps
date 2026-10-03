import { dayOf, googleMapsDirections, hhmm, placeOf, trip, type Stop, type StopForecast } from "@trip/shared";
import type { Live } from "../App";
import { ago, dayLabel, statusText } from "../format";
import { DayPicker } from "./DayPicker";

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
    <li className="stop">
      <div className="time">{hhmm(stop.start)}</div>
      <div className="stop-body">
        <div className="stop-name">{stop.nameHe}</div>
        <div className="stop-meta">
          <Forecast f={f} />
          <a href={googleMapsDirections(stop)} target="_blank" rel="noreferrer">ניווט</a>
        </div>
        {stop.noteHe && <div className="note">{stop.noteHe}</div>}
      </div>
    </li>
  );
}

export function Today({ date, setDate, live, refresh, openAlerts }: { date: string; setDate: (d: string) => void; live: Live; refresh: () => void; openAlerts: () => void }) {
  const day = dayOf(trip, date)!;
  const status = live.state?.dayStatus[date];
  const lodging = day.lodgingId ? placeOf(trip, `lodging:${day.lodgingId}`) : undefined;
  const dayAlerts = live.state?.alerts.filter((a) => a.date === date && a.category !== "reminder") ?? [];

  return (
    <>
      <DayPicker date={date} setDate={setDate} status={live.state?.dayStatus} />
      <header className="day-head">
        <div className="eyebrow">{dayLabel(date)}</div>
        <h1>{day.titleHe}</h1>
      </header>

      <button className={`statusbar ${status ?? "none"}`} onClick={openAlerts}>
        <strong>{status ? statusText[status] : live.loading ? "בודק..." : "אין נתונים חיים"}</strong>
        <span>{dayAlerts.length ? `${dayAlerts.length} התראות ›` : live.state ? `עודכן ${ago(live.state.generatedAt)}` : ""}</span>
      </button>
      {live.offline && (
        <p className="offline" onClick={refresh}>
          מוצג מידע שמור. {live.error} · לחצו לרענון
        </p>
      )}

      <ol className="timeline">
        {day.drives.length > 0 && (
          <li className="drive">
            <div className="time">{hhmm(day.drives[0].departAt)}</div>
            <div className="stop-body">יציאה עם הוואן</div>
          </li>
        )}
        {day.stops.map((s) => (
          <StopRow key={s.id} stop={s} f={live.state?.forecasts[s.id]} />
        ))}
      </ol>

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
        <section className="card">
          <h2>לינה</h2>
          <p>
            {lodging.nameHe} · <a href={googleMapsDirections(lodging)} target="_blank" rel="noreferrer">ניווט למלון</a>
          </p>
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
