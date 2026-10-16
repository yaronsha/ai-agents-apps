import { useCallback, useEffect, useRef, useState } from "react";
import { defaultDate, publicTrip, thDate, withPrivate, type LatLng } from "@trip/shared";
import { cachedPrivate, loadPrivate, loadState } from "./api";
import type { Live } from "./live";
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

/** A computer screen: side menu, the plan in the middle and the map always open beside it. */
const DESKTOP = "(min-width: 1100px)";
function useDesktop(): boolean {
  const [desktop, setDesktop] = useState(() => window.matchMedia(DESKTOP).matches);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP);
    const on = () => setDesktop(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return desktop;
}

const tabFromHash = (): Tab => {
  const h = window.location.hash.slice(1);
  return (TABS.find((t) => t.id === h)?.id ?? "today") as Tab;
};

export function App() {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [date, setDate] = useState(() => defaultDate(publicTrip, new Date()));
  // The private file rarely changes; a new trip object would make every screen (and the map) rebuild.
  const [initialPriv] = useState(cachedPrivate);
  const privJson = useRef(JSON.stringify(initialPriv));
  const [trip, setTrip] = useState(() => withPrivate(publicTrip, initialPriv));
  const [live, setLive] = useState<Live>({ state: null, offline: false, loading: true });

  // Coming back to the app and tapping refresh can overlap; only the newest request may write.
  const lastRefresh = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++lastRefresh.current;
    setLive((l) => ({ ...l, loading: true }));
    const [r, priv] = await Promise.all([loadState(), loadPrivate()]);
    if (id !== lastRefresh.current) return;
    setLive({ ...r, loading: false });
    const json = priv && JSON.stringify(priv);
    if (json && json !== privJson.current) {
      privJson.current = json;
      setTrip(withPrivate(publicTrip, priv));
    }
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

  const desktop = useDesktop();
  // On a computer the map is always on screen, so there is no map tab: a link to it opens the plan.
  const shown: Tab = desktop && tab === "map" ? "today" : tab;
  const [mapFocus, setMapFocus] = useState<LatLng | null>(null);

  const go = (t: Tab) => {
    window.location.hash = t;
    setTab(t);
  };
  const openMap = (at: LatLng) => (desktop ? setMapFocus({ lat: at.lat, lng: at.lng }) : go("map"));
  /** The alerts screen, scrolled to the "ask for a new plan" box. */
  const openReplan = () => {
    go("alerts");
    requestAnimationFrame(() => {
      document.getElementById("replan-problem")?.scrollIntoView({ block: "center" });
    });
  };
  const first = publicTrip.days[0].date;
  const last = publicTrip.days[publicTrip.days.length - 1].date;
  const activeCount = live.state?.alerts.filter((a) => a.category !== "reminder" && a.date >= thDate(new Date())).length ?? 0;
  const dayTab = DAY_TABS.includes(shown);

  const head = (
    <header className="app-head">
      <div>
        <div className="app-title">צפון תאילנד</div>
        <div className="app-sub">
          {shortDay(first)}–{shortDay(last)}.{last.slice(0, 4)} · {daysBetween(first, last)} לילות
        </div>
      </div>
      <span className="phase">{tripPhase(first, last, thDate(new Date()))}</span>
    </header>
  );
  const nav = (
    <nav className={desktop ? "sidenav" : "tabbar"} aria-label="מסכים">
      {TABS.filter((t) => !desktop || t.id !== "map").map((t) => (
        <button key={t.id} className={shown === t.id ? "active" : ""} aria-current={shown === t.id ? "page" : undefined} onClick={() => go(t.id)}>
          <span className="tab-icon">
            <Icon name={t.id} size={22} />
            {t.id === "alerts" && activeCount > 0 && (
              <span className="count">
                {activeCount}
                <span className="sr-only"> התראות פעילות</span>
              </span>
            )}
          </span>
          {t.label}
        </button>
      ))}
    </nav>
  );
  const screen = (
    <main className={`screen ${shown === "map" ? "screen-map" : ""}`}>
      {shown === "today" && (
        <Today date={date} live={live} refresh={refresh} openAlerts={() => go("alerts")} openMap={openMap} openReplan={openReplan} />
      )}
      {shown === "map" && <MapView date={date} setDate={setDate} live={live} openAlerts={() => go("alerts")} />}
      {shown === "alerts" && <Alerts date={date} live={live} refresh={refresh} />}
      {shown === "sos" && <Emergency date={date} />}
      {shown === "settings" && <Settings live={live} refresh={refresh} />}
    </main>
  );
  const dayPicker = dayTab && <DayPicker date={date} setDate={setDate} status={live.state?.dayStatus} />;

  return (
    <TripContext.Provider value={trip}>
      {desktop ? (
        <div className={`shell desktop ${dayTab ? "" : "no-strip"}`}>
          <aside className="side">
            {head}
            {nav}
          </aside>
          {dayPicker}
          {screen}
          <div className="dock-map">
            <MapView date={date} setDate={setDate} live={live} openAlerts={() => go("alerts")} docked flyTo={mapFocus} />
          </div>
        </div>
      ) : (
        <div className="shell">
          {head}
          {dayPicker}
          {screen}
          {nav}
        </div>
      )}
    </TripContext.Provider>
  );
}
