import { useEffect, useState } from "react";
import type { Live } from "../App";
import { enablePush, previewAt, pushEnabled, pushSupport, settings, testPush } from "../api";
import { ago } from "../format";

const SOURCE_HE: Record<string, string> = {
  weather: "מזג אוויר ואיכות אוויר",
  quakes: "רעידות אדמה",
  advisory: "אזהרת מסע",
  news: "חדשות",
  routes: "זמני נסיעה",
  flights: "טיסות",
};

export function Settings({ live, refresh }: { live: Live; refresh: () => void }) {
  const [api, setApi] = useState(settings.apiUrl());
  const [token, setToken] = useState(settings.token());
  const [msg, setMsg] = useState<string | null>(null);
  const [push, setPush] = useState(false);
  const [at, setAt] = useState("2026-11-26T12:00");
  const support = pushSupport();

  useEffect(() => {
    pushEnabled().then(setPush);
  }, []);

  const run = async (fn: () => Promise<string>) => {
    setMsg("...");
    try {
      setMsg(await fn());
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const save = () => {
    settings.setApiUrl(api);
    settings.setToken(token);
    setMsg("נשמר");
    refresh();
  };

  return (
    <>
      <header className="day-head">
        <h1>הגדרות</h1>
      </header>

      <section className="card form">
        <label>
          כתובת השרת
          <input dir="ltr" value={api} onChange={(e) => setApi(e.target.value)} placeholder="https://thailand-trip.example.workers.dev" />
        </label>
        <label>
          קוד גישה
          <input dir="ltr" value={token} onChange={(e) => setToken(e.target.value)} type="password" />
        </label>
        <button className="primary" onClick={save}>
          שמירה
        </button>
      </section>

      <section className="card">
        <h2>התראות פוש</h2>
        {support === "ios-not-installed" && <p>באייפון: לחצו על שיתוף ואז "הוסף למסך הבית", ופתחו את האפליקציה משם.</p>}
        {support === "unsupported" && <p>הדפדפן הזה לא תומך בהתראות פוש.</p>}
        {support === "ok" && (
          <>
            <p>{push ? "המכשיר הזה רשום להתראות." : "המכשיר הזה עוד לא רשום."}</p>
            <div className="row">
              <button className="primary" onClick={() => run(async () => `נרשם. ${await enablePush()} מכשירים רשומים.`).then(() => pushEnabled().then(setPush))}>
                {push ? "רישום מחדש" : "הפעלת התראות"}
              </button>
              <button onClick={() => run(async () => `נשלח ל-${(await testPush()).sent} מכשירים`)}>שליחת התראת בדיקה</button>
            </div>
          </>
        )}
        <p className="muted">שקט מ-22:00 עד 06:00, חוץ מדברים דחופים. תדריך על מחר בכל ערב ב-20:00.</p>
      </section>

      <section className="card form">
        <h2>תצוגה מקדימה</h2>
        <p className="muted">איך המנוע רואה רגע אחר בטיול, בלי לשלוח פוש. תחזית אמיתית קיימת רק עד 16 יום קדימה.</p>
        <input dir="ltr" value={at} onChange={(e) => setAt(e.target.value)} />
        <button onClick={() => run(async () => `${(await previewAt(at)).alerts.filter((a) => a.category !== "reminder").length} התראות ברגע הזה`)}>
          הרצה
        </button>
      </section>

      {live.state && (
        <section className="card">
          <h2>מקורות מידע</h2>
          <p className="muted">עדכון אחרון {ago(live.state.generatedAt)}</p>
          {Object.entries(live.state.sources).map(([k, v]) => (
            <p key={k}>
              {v.ok ? "✓" : "✗"} {SOURCE_HE[k] ?? k}
              {v.note ? ` · ${v.note}` : ""}
            </p>
          ))}
        </section>
      )}
      {msg && <p className="toast">{msg}</p>}
    </>
  );
}
