import { useState } from "react";
import { dayOf, thDate, type TripAlert } from "@trip/shared";
import { useTrip } from "../tripContext";
import type { Live } from "../App";
import { replan } from "../api";
import { dayLabel, severityText, shortDay } from "../format";
import { DayPicker } from "./DayPicker";

const CATEGORY_HE: Record<TripAlert["category"], string> = {
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

function AlertCard({ a }: { a: TripAlert }) {
  return (
    <article className={`alert ${a.severity}`}>
      <div className="alert-top">
        <span className="badge">{severityText[a.severity]}</span>
        <span className="muted">
          {CATEGORY_HE[a.category]} · {shortDay(a.date)}
        </span>
      </div>
      <h3>{a.titleHe}</h3>
      <p>{a.bodyHe}</p>
      {a.url && (
        <a href={a.url} target="_blank" rel="noreferrer">
          למקור
        </a>
      )}
    </article>
  );
}

export function Alerts({ date, setDate, live, refresh }: { date: string; setDate: (d: string) => void; live: Live; refresh: () => void }) {
  const [problem, setProblem] = useState("");
  const [plan, setPlan] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const trip = useTrip();
  const day = dayOf(trip, date)!;
  const today = thDate(new Date());
  const order = { urgent: 0, warning: 1, info: 2 };
  const upcoming = (live.state?.alerts ?? [])
    .filter((a) => a.category !== "reminder" && a.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || order[a.severity] - order[b.severity]);
  const forDay = upcoming.filter((a) => a.date === date);
  const later = upcoming.filter((a) => a.date !== date);

  const ask = async () => {
    setBusy(true);
    setErr(null);
    try {
      setPlan((await replan(date, problem)).text);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DayPicker date={date} setDate={(d) => (setDate(d), setPlan(null))} status={live.state?.dayStatus} />
      <header className="day-head">
        <div className="eyebrow">{dayLabel(date)}</div>
        <h1>בלת"מים ותוכניות ב'</h1>
      </header>

      {forDay.length === 0 ? (
        <p className="empty">{live.state ? "אין התראות ליום הזה." : "אין עדיין נתונים חיים. בדקו את ההגדרות."}</p>
      ) : (
        forDay.map((a) => <AlertCard key={a.id} a={a} />)
      )}

      <section className="card">
        <h2>תוכנית ב' מוכנה</h2>
        <ul>
          {day.planB.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </section>

      <section className="card replan">
        <h2>תכנן לי מחדש</h2>
        <textarea
          rows={3}
          placeholder="מה קרה? למשל: הכביש לפאי חסום עד הצהריים"
          value={problem}
          onChange={(e) => setProblem(e.target.value)}
        />
        <button className="primary" onClick={ask} disabled={busy}>
          {busy ? "חושב..." : "בקש תוכנית מעודכנת"}
        </button>
        {err && <p className="error">{err}</p>}
        {plan && <div className="plan">{plan}</div>}
      </section>

      {later.length > 0 && (
        <>
          <h2 className="section-title">בימים הבאים</h2>
          {later.map((a) => (
            <AlertCard key={a.id} a={a} />
          ))}
        </>
      )}
      <button className="link" onClick={refresh}>
        רענון
      </button>
    </>
  );
}
