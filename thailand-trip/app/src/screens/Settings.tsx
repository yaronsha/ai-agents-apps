import { useEffect, useState } from "react";
import type { Trip } from "@trip/shared";
import type { Live } from "../App";
import { enablePush, errorText, previewAt, pushEnabled, pushSupport, serverConfig, settings, testPush } from "../api";
import { ago, shortDay } from "../format";
import { useTrip } from "../tripContext";

const dayBefore = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

/** Every source the server checks, in display order, with when it is checked for one not checked yet. */
const SOURCES = (trip: Trip): { key: string; he: string; when: string }[] => [
  { key: "weather", he: "מזג אוויר ואיכות אוויר", when: "פעם בשעה" },
  { key: "advisory", he: "אזהרות מסע של בריטניה", when: "פעם בשעה" },
  { key: "news", he: "חדשות", when: `מ-${shortDay(dayBefore(trip.startDate, 7))}` },
  { key: "quakes", he: "רעידות אדמה", when: `מ-${shortDay(trip.days[0].date)}` },
  { key: "routes", he: "זמני נסיעה", when: "לפני כל נסיעה" },
  { key: "flights", he: "טיסות", when: "יום לפני כל טיסה" },
];

export function Settings({ live, refresh }: { live: Live; refresh: () => void }) {
  const [token, setToken] = useState(settings.token());
  const [auth, setAuth] = useState<"access" | "token" | null>(null);
  const [configured, setConfigured] = useState<Partial<Record<string, boolean>>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [push, setPush] = useState(false);
  const [at, setAt] = useState("2026-11-26T12:00");
  const support = pushSupport();
  const trip = useTrip();

  useEffect(() => {
    pushEnabled().then(setPush);
    // Older servers don't say; treat them as access-code servers.
    serverConfig().then(
      (c) => {
        setAuth(c.auth ?? "token");
        setConfigured(c.configured ?? {});
      },
      () => setAuth(null),
    );
  }, []);

  const run = async (fn: () => Promise<string>) => {
    setMsg("...");
    try {
      setMsg(await fn());
    } catch (e) {
      setMsg(errorText(e));
    }
  };

  const save = () => {
    settings.setToken(token);
    setMsg("נשמר");
    refresh();
  };

  return (
    <>
      <header className="day-head">
        <h1>הגדרות</h1>
      </header>

      {/* With Cloudflare sign-in the allow list does the job and there is no code to type. */}
      {auth === "token" && (
        <section className="card form">
          <label>
            קוד גישה
            <input dir="ltr" value={token} onChange={(e) => setToken(e.target.value)} type="password" />
          </label>
          <button className="primary" onClick={save}>
            שמירה
          </button>
        </section>
      )}

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
          <h2>מה האפליקציה בודקת</h2>
          <ul className="sources">
            {SOURCES(trip).map(({ key, he, when }) => {
              const s = live.state!.sources[key];
              return (
                <li key={key}>
                  <span className={`dot ${s ? (s.ok ? "ok" : "bad") : "wait"}`} />
                  <span className="name">
                    {he}
                    {s?.note && (
                      <span className="note">
                        <bdi>{s.note}</bdi>
                      </span>
                    )}
                  </span>
                  <span className="when">{s ? `${s.ok ? "" : "נכשל "}${ago(s.at)}` : configured[key] === false ? "לא מוגדר בשרת" : when}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {msg && <p className="toast">{msg}</p>}
    </>
  );
}
