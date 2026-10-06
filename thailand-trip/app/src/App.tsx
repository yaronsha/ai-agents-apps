import { useCallback, useEffect, useState } from "react";
import { defaultDate, publicTrip, thDate, withPrivate, type TripState } from "@trip/shared";
import { cachedPrivate, loadPrivate, loadState } from "./api";
import { TripContext } from "./tripContext";
import { Today } from "./screens/Today";
import { MapView } from "./screens/MapView";
import { Alerts } from "./screens/Alerts";
import { Emergency } from "./screens/Emergency";
import { Settings } from "./screens/Settings";

const TABS = [
  { id: "today", label: "היום", icon: "☀" },
  { id: "map", label: "מפה", icon: "◎" },
  { id: "alerts", label: "בלת\"מים", icon: "!" },
  { id: "sos", label: "חירום", icon: "✚" },
  { id: "settings", label: "הגדרות", icon: "⚙" },
] as const;
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
  const activeCount = live.state?.alerts.filter((a) => a.category !== "reminder" && a.date >= thDate(new Date())).length ?? 0;

  return (
    <TripContext.Provider value={trip}>
    <div className="shell">
      <main className="screen">
        {tab === "today" && <Today date={date} setDate={setDate} live={live} refresh={refresh} openAlerts={() => go("alerts")} />}
        {tab === "map" && <MapView date={date} setDate={setDate} live={live} />}
        {tab === "alerts" && <Alerts date={date} setDate={setDate} live={live} refresh={refresh} />}
        {tab === "sos" && <Emergency date={date} />}
        {tab === "settings" && <Settings live={live} refresh={refresh} />}
      </main>
      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => go(t.id)}>
            <span className="tab-icon" aria-hidden>
              {t.icon}
              {t.id === "alerts" && activeCount > 0 && <span className="dot" />}
            </span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
    </TripContext.Provider>
  );
}
