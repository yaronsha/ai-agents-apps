import { useCallback, useEffect, useState } from "react";
import { defaultDate, publicTrip, thDate, withPrivate, type TripState } from "@trip/shared";
import { cachedPrivate, loadPrivate, loadState } from "./api";
import { TripContext } from "./tripContext";
import { Today } from "./screens/Today";
import { MapView } from "./screens/MapView";
import { Alerts } from "./screens/Alerts";
import { Emergency } from "./screens/Emergency";
import { Settings } from "./screens/Settings";
import { DayPicker } from "./screens/DayPicker";
import { Icon } from "./icons";
import { daysBetween, shortDay } from "./format";

const TABS = [
  { id: "today", label: "היום" },
  { id: "map", label: "מפה" },
  { id: "alerts", label: "בלת\"מים" },
  { id: "sos", label: "חירום" },
  { id: "settings", label: "הגדרות" },
] as const;

/** Tabs that are about one day of the plan and share the day strip. */
const DAY_TABS: readonly string[] = ["today", "map", "alerts"];

/** "עוד 50 ימים" before the trip, "יום 3 מתוך 12" during it. */
function tripPhase(first: string, last: string, today: string): string {
  if (today < first) {
    const n = daysBetween(today, first);
    return n === 1 ? "מחר טסים" : `עוד ${n} ימים`;
  }
  if (today > last) return "הטיול הסתיים";
  return `יום ${daysBetween(first, today) + 1} מתוך ${daysBetween(first, last) + 1}`;
}
type Tab = (typeof TABS)[number]["id"];

const tabFromHash = (): Tab => {
  const h = window.location.hash.slice(1);
  return (TABS.find((t) => t.id === h)?.id ?? "today") as Tab;
};

export interface Live {
  state: TripState | null;
  offline: boolean;
  /** The server answered, but its data is old (the cron may have stopped). */
  stale?: boolean;
  error?: string;
  loading: boolean;
}

export function App() {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [date, setDate] = useState(() => defaultDate(publicTrip, new Date()));
  const [trip, setTrip] = useState(() => withPrivate(publicTrip, cachedPrivate()));
  const [live, setLive] = useState<Live>({ state: null, offline: false, loading: true });

  const refresh = useCallback(async () => {
    setLive((l) => ({ ...l, loading: true }));
    const [r, priv] = await Promise.all([loadState(), loadPrivate()]);
    setLive({ ...r, loading: false });
    if (priv) setTrip(withPrivate(publicTrip, priv));
  }, []);

  useEffect(() => {
    refresh();
    const onHash = () => setTab(tabFromHash());
    const onVisible = () => document.visibilityState === "visible" && refresh();
    window.addEventListener("hashchange", onHash);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("hashchange", onHash);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const go = (t: Tab) => {
    window.location.hash = t;
    setTab(t);
  };
  const first = publicTrip.days[0].date;
  const last = publicTrip.days[publicTrip.days.length - 1].date;
  const activeCount = live.state?.alerts.filter((a) => a.category !== "reminder" && a.date >= thDate(new Date())).length ?? 0;

  return (
    <TripContext.Provider value={trip}>
    <div className="shell">
      <header className="app-head">
        <div>
          <div className="app-title">צפון תאילנד</div>
          <div className="app-sub">
            {shortDay(first)}–{shortDay(last)}.{last.slice(0, 4)} · {daysBetween(first, last)} לילות
          </div>
        </div>
        <span className="phase">{tripPhase(first, last, thDate(new Date()))}</span>
      </header>
      {DAY_TABS.includes(tab) && <DayPicker date={date} setDate={setDate} status={live.state?.dayStatus} />}
      <main className={`screen ${tab === "map" ? "screen-map" : ""}`}>
        {tab === "today" && <Today date={date} live={live} refresh={refresh} openAlerts={() => go("alerts")} />}
        {tab === "map" && <MapView date={date} setDate={setDate} live={live} />}
        {tab === "alerts" && <Alerts date={date} live={live} refresh={refresh} />}
        {tab === "sos" && <Emergency date={date} />}
        {tab === "settings" && <Settings live={live} refresh={refresh} />}
      </main>
      <nav className="tabbar" aria-label="מסכים">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "active" : ""} aria-current={tab === t.id ? "page" : undefined} onClick={() => go(t.id)}>
            <span className="tab-icon">
              <Icon name={t.id} size={22} />
              {t.id === "alerts" && activeCount > 0 && (
                <span className="count" aria-label={`${activeCount} התראות פעילות`}>
                  {activeCount}
                </span>
              )}
            </span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
    </TripContext.Provider>
  );
}
