import { useEffect, useRef, useState } from "react";
import { dayOf, thDate, type TripAlert } from "@trip/shared";
import { useTrip } from "../tripContext";
import type { Live } from "../App";
import { replan } from "../api";
import { dayLabel, severityText, shortDay } from "../format";
import { CATEGORY_HE, GROUPS, worstOf } from "../categories";
import { Icon } from "../icons";

function AlertCard({ a }: { a: TripAlert }) {
  return (
    <article className={`alert ${a.severity}`}>
      <div className="alert-top">
        <span className={`pill ${a.severity}`}>{severityText[a.severity]}</span>
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

function StatusGrid({ alerts, hasData }: { alerts: TripAlert[]; hasData: boolean }) {
  return (
    <div className="status-grid">
      {GROUPS.map((g) => {
        const worst = worstOf(alerts, g.categories);
        const sev = !hasData ? "none" : worst?.severity ?? "ok";
        return (
          <div key={g.id} className={`tile ${sev}`}>
            <div className="tile-name">
              <Icon name={g.icon} size={18} />
              {g.labelHe}
            </div>
            <span className={`pill ${sev}`}>{!hasData ? "אין נתונים" : worst ? severityText[worst.severity] : "תקין"}</span>
            <div className="tile-text">{!hasData ? "—" : worst?.titleHe ?? g.okHe}</div>
          </div>
        );
      })}
    </div>
  );
}

export function Alerts({ date, live, refresh }: { date: string; live: Live; refresh: () => void }) {
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

  // A plan written for one day makes no sense under another, including one that
  // arrives after the user has already moved to a different day.
  const shownDate = useRef(date);
  useEffect(() => {
    shownDate.current = date;
    setPlan(null);
  }, [date]);

  const ask = async () => {
    const asked = date;
    setBusy(true);
    setErr(null);
    try {
      const { text } = await replan(asked, problem);
      if (shownDate.current === asked) setPlan(text);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="day-head">
        <div className="eyebrow">{dayLabel(date)}</div>
        <h1>בלת"מים ותוכניות ב'</h1>
      </header>

      <StatusGrid alerts={forDay} hasData={Boolean(live.state)} />

      <h2 className="section-title">התראות ליום הזה</h2>
      {forDay.length === 0 ? (
        <p className="empty">{live.state ? "אין התראות ליום הזה. הכול לפי התוכנית." : "אין עדיין נתונים חיים. בדקו את ההגדרות."}</p>
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
        <h2 id="replan-title">תכנן לי מחדש</h2>
        <textarea
          id="replan-problem"
          aria-labelledby="replan-title"
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
