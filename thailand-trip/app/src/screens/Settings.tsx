import { useEffect, useState } from "react";
import type { Trip } from "@trip/shared";
import type { Live } from "../live";
import { enablePush, errorText, pushEnabled, pushSupport, serverConfig, settings, testPush } from "../api";
import { ago, shortDay } from "../format";
import { useTrip } from "../tripContext";

const dayBefore = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

/** Every source the server checks, in display order, with when it is checked for one not checked yet. */
const SOURCES = (trip: Trip): { key: string; he: string; when: string }[] => [
  { key: "weather", he: "מזג אוויר ואיכות אוויר", when: "פעם בשעה" },
  { key: "advisory", he: "אזהרות מסע של בריטניה", when: "פעם בשעה" },
  { key: "news", he: "חדשות", when: `מ-${shortDay(dayBefore(trip.startDate, 7))}` },
  { key: "places", he: "שינויים באתרים שבמסלול", when: "פעם בשבוע, ובטיול פעמיים ביום" },
  { key: "quakes", he: "רעידות אדמה", when: `מ-${shortDay(trip.days[0].date)}` },
  { key: "routes", he: "זמני נסיעה", when: "לפני כל נסיעה" },
  { key: "flights", he: "טיסות", when: "יום לפני כל טיסה" },
  { key: "push", he: "שליחת התראות לטלפון", when: "כשיש התראה" },
];

export function Settings({ live, refresh }: { live: Live; refresh: () => void }) {
  const [token, setToken] = useState(settings.token());
  const [auth, setAuth] = useState<"access" | "token" | null>(null);
  const [configured, setConfigured] = useState<Partial<Record<string, boolean>>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [push, setPush] = useState(false);
  const support = pushSupport();
  const trip = useTrip();

  useEffect(() => {
    pushEnabled().then(setPush, () => setPush(false));
    // Older servers don't say; treat them as access-code servers.
    serverConfig().then(
      (c) => {
        setAuth(c.auth ?? "token");
        setConfigured(c.configured ?? {});
      },
      () => setAuth(null),
    );
  }, []);

  // A result stays up long enough to read, then gets out of the way of the sources list.
  // An error stays until the next action, since it is the one message that needs reading.
  useEffect(() => {
    if (!msg || busy || failed) return;
    const t = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(t);
  }, [msg, busy, failed]);

  // One request at a time: a second tap on "test push" would send a second push.
  const run = async (fn: () => Promise<string>) => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    setMsg("רגע...");
    try {
      setMsg(await fn());
    } catch (e) {
      setFailed(true);
      setMsg(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    settings.setToken(token);
    setFailed(false);
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
              <button className="primary" disabled={busy} onClick={() => run(async () => `נרשם. ${await enablePush()} מכשירים רשומים.`).then(() => pushEnabled().then(setPush, () => setPush(false)))}>
                {push ? "רישום מחדש" : "הפעלת התראות"}
              </button>
              <button disabled={busy} onClick={() => run(async () => `נשלח ל-${(await testPush()).sent} מכשירים`)}>שליחת התראת בדיקה</button>
            </div>
          </>
        )}
        <p className="muted">שקט מ-22:00 עד 06:00, חוץ מדברים דחופים. תדריך על מחר בכל ערב ב-20:00.</p>
      </section>

      {live.state && (
        <section className="card">
          <h2>מה האפליקציה בודקת</h2>
          <ul className="sources">
            {SOURCES(trip).map(({ key, he, when }) => {
              const s = live.state?.sources?.[key];
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
