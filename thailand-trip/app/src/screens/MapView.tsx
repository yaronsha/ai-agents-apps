import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { dayOrDefault, hhmm, hospitals, placeOf, publicTrip, googleMapsDirections, type LatLng, type Stop } from "@trip/shared";
import { useTrip } from "../tripContext";
import type { Live } from "../live";
import { dayLabel, severityText, shortDay } from "../format";
import { GROUPS, worstOf } from "../categories";
import { Icon } from "../icons";
import { StopSheet } from "./Sheets";

/** Popup HTML is built from strings; names and notes go in escaped so no data can inject markup. */
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const dayColor = (i: number) => `hsl(${(i * 360) / publicTrip.days.length + 170}, 62%, 38%)`;

export function MapView({
  date,
  setDate,
  live,
  openAlerts,
  docked = false,
  flyTo,
}: {
  date: string;
  setDate: (d: string) => void;
  live: Live;
  openAlerts: () => void;
  /** Beside the plan on a computer: the day card is left out, the plan next to it already shows the day. */
  docked?: boolean;
  /** A place to fly to ("על המפה" in a place card); a new object each time, so the same place can be asked twice. */
  flyTo?: LatLng | null;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<L.LayerGroup | null>(null);
  const [showHospitals, setShowHospitals] = useState(false);
  const [locating, setLocating] = useState(false);
  const me = useRef<L.CircleMarker | null>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const tools = useRef<HTMLDivElement>(null);
  const focus = useRef<L.LatLngBounds | null>(null);
  const trip = useTrip();
  const [place, setPlace] = useState<{ stop: Stop; date: string } | null>(null);

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { zoomControl: false }).setView([19.3, 99.2], 8);
    L.control.zoom({ position: "topleft" }).addTo(map.current);
    // English place names: /tiles is our own Pages Function, which fetches CARTO Voyager with the key
    // kept on the server (functions/tiles). Same address as the app, so the service worker can cache it.
    L.tileLayer("/tiles/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map.current);
    layers.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Stops with a live warning get a ring. Kept as a string key so a refresh that brings the same
  // alerts back changes nothing on the map.
  const alertedKey = (live.state?.alerts ?? [])
    .filter((a) => a.stopId && a.severity !== "info")
    .map((a) => a.stopId)
    .sort()
    .join(" ");
  const alerted = useRef(new Set<string>());
  alerted.current = new Set(alertedKey ? alertedKey.split(" ") : []);
  const pins = useRef(new Map<string, L.Marker>());

  // Markers and routes: rebuilt only when the day, the trip or the hospital layer changes, never on a
  // state refresh, so coming back to the app keeps the user's pan and zoom.
  useEffect(() => {
    const m = map.current;
    const g = layers.current;
    if (!m || !g) return;
    g.clearLayers();
    pins.current.clear();
    focus.current = null;

    trip.days.forEach((day, i) => {
      const selected = day.date === date;
      const color = dayColor(i);
      const lodging = day.lodgingId ? placeOf(trip, `lodging:${day.lodgingId}`) : undefined;
      const prevLodging = i > 0 && trip.days[i - 1].lodgingId ? placeOf(trip, `lodging:${trip.days[i - 1].lodgingId}`) : undefined;
      const path = [prevLodging, ...day.stops, lodging].filter(Boolean).map((p) => [p!.lat, p!.lng] as [number, number]);
      L.polyline(path, { color, weight: selected ? 5 : 2.5, opacity: selected ? 0.9 : 0.35, dashArray: selected ? undefined : "4 6" }).addTo(g);

      day.stops.forEach((s, n) => {
        const icon = L.divIcon({
          className: "",
          html: `<div class="pin ${selected ? "sel" : ""} ${alerted.current.has(s.id) ? "warn" : ""}" style="--c:${color}">${selected ? n + 1 : ""}</div>`,
          iconSize: selected ? [26, 26] : [12, 12],
          iconAnchor: selected ? [13, 13] : [6, 6],
        });
        const marker = L.marker([s.lat, s.lng], { icon, title: `${s.nameHe}, ${shortDay(day.date)}`, zIndexOffset: selected ? 1000 : 0 })
          .bindPopup(
            `<b>${esc(s.nameHe)}</b><br>${shortDay(day.date)} · ${hhmm(s.start)}${s.noteHe ? `<br><small>${esc(s.noteHe)}</small>` : ""}<br><a href="${esc(googleMapsDirections(s))}" target="_blank" rel="noopener">ניווט</a><br><button class="popup-more">עוד על המקום</button>`,
          )
          .on("popupopen", (e) =>
            e.popup.getElement()?.querySelector(".popup-more")?.addEventListener("click", () => {
              m.closePopup();
              setPlace({ stop: s, date: day.date });
            }),
          )
          .on("click", () => day.date !== date && setDate(day.date))
          .addTo(g);
        pins.current.set(s.id, marker);
      });
      if (selected && path.length) focus.current = L.latLngBounds(path);
    });

    trip.lodgings.forEach((l) =>
      L.marker([l.lat, l.lng], { icon: L.divIcon({ className: "", html: '<div class="pin-hotel">⌂</div>', iconSize: [20, 20], iconAnchor: [10, 10] }), title: l.name })
        .bindPopup(`<b>${esc(l.name)}</b><br>${shortDay(l.checkIn)}–${shortDay(l.checkOut)}`)
        .addTo(g),
    );

    if (showHospitals) {
      hospitals.forEach((h) =>
        L.marker([h.lat, h.lng], { icon: L.divIcon({ className: "", html: '<div class="pin-hospital">✚</div>', iconSize: [20, 20], iconAnchor: [10, 10] }), title: h.name })
          .bindPopup(`<b>${esc(h.name)}</b><br>${esc(h.area)}<br><a href="${esc(googleMapsDirections(h))}" target="_blank" rel="noopener">ניווט</a>`)
          .addTo(g),
      );
    }
  }, [date, showHospitals, setDate, trip]);

  // A state refresh only moves the warning rings.
  useEffect(() => {
    for (const [id, marker] of pins.current) marker.getElement()?.querySelector(".pin")?.classList.toggle("warn", alerted.current.has(id));
  }, [alertedKey]);

  // Re-frame only when the day changes (and on first open); the button does it on demand.
  useEffect(() => {
    fitDay();
  }, [date]);

  // Opening straight to the map measures the day card before the state fills it; re-frame once
  // when the first state arrives, never on later refreshes.
  const fittedWithState = useRef(false);
  useEffect(() => {
    if (!live.state || fittedWithState.current) return;
    fittedWithState.current = true;
    fitDay();
  }, [live.state]);

  /** Frames the selected day's route between the map buttons and the day card. */
  function fitDay() {
    const m = map.current;
    if (!m || !focus.current) return;
    const above = (tools.current?.offsetHeight ?? 0) + 20;
    const below = (sheet.current?.offsetHeight ?? 0) + 36;
    m.fitBounds(focus.current, { paddingTopLeft: [40, above], paddingBottomRight: [40, below], maxZoom: 12 });
  }

  useEffect(() => {
    const m = map.current;
    if (!m || !flyTo) return;
    m.setView([flyTo.lat, flyTo.lng], Math.max(m.getZoom(), 14));
    for (const marker of pins.current.values()) {
      const ll = marker.getLatLng();
      if (ll.lat === flyTo.lat && ll.lng === flyTo.lng) marker.openPopup();
    }
  }, [flyTo]);

  const locate = () => {
    if (!navigator.geolocation || !map.current) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const ll: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        me.current?.remove();
        me.current = L.circleMarker(ll, { radius: 8, color: "#fff", weight: 3, fillColor: "#2563eb", fillOpacity: 1 }).addTo(map.current!);
        map.current!.setView(ll, 13);
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const day = dayOrDefault(trip, date);
  const dayAlerts = live.state?.alerts.filter((a) => a.date === date && a.category !== "reminder") ?? [];
  const lodging = day.lodgingId ? placeOf(trip, `lodging:${day.lodgingId}`) : undefined;
  const temps = day.stops.map((s) => live.state?.forecasts[s.id]).filter((f) => f && f.tempMax !== null);
  const hi = temps.length ? Math.round(Math.max(...temps.map((f) => f!.tempMax!))) : null;
  const lo = temps.length ? Math.round(Math.min(...temps.map((f) => f!.tempMin ?? f!.tempMax!))) : null;

  return (
    <div className="map-screen">
      <div className="map" ref={el} />
      <div className="map-tools" ref={tools}>
        <button onClick={locate}>
          <Icon name="locate" size={18} />
          {locating ? "מאתר..." : "איפה אני"}
        </button>
        <button className={showHospitals ? "on" : ""} aria-pressed={showHospitals} onClick={() => setShowHospitals((v) => !v)}>
          <Icon name="hospital" size={18} />
          בתי חולים
        </button>
        <button onClick={fitDay}>
          <Icon name="fit" size={18} />
          המסלול של היום
        </button>
      </div>
      {!docked && (
      <section className="map-sheet" ref={sheet}>
        <div className="sheet-row">
          <div className="sheet-title">
            <div className="eyebrow">{dayLabel(date)}</div>
            <h2>{day.titleHe}</h2>
          </div>
          {hi !== null && (
            <div className="sheet-temp">
              <span className="sr-only">טמפרטורה </span>
              <strong>{hi}°</strong>
              <span>/{lo}°</span>
            </div>
          )}
        </div>
        {lodging && (
          <div className="sheet-meta">
            <Icon name="bed" size={16} />
            {lodging.nameHe}
          </div>
        )}
        <button className="sheet-chips" onClick={openAlerts}>
          {GROUPS.map((g) => {
            const w = live.state ? worstOf(dayAlerts, g.categories) : undefined;
            const sev = !live.state ? "none" : w?.severity ?? "ok";
            return (
              <span key={g.id} className={`pill ${sev}`} title={w ? `${severityText[w.severity]}: ${w.titleHe}` : undefined}>
                {w && w.severity !== "info" ? (
                  <>
                    <svg className="sev" width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 2 23 21H1z" fill="currentColor" />
                      <path d="M12 9v5M12 17.5v.5" stroke="var(--surface)" strokeWidth="2.6" strokeLinecap="round" />
                    </svg>
                    <span className="sr-only">{severityText[w.severity]}: </span>
                  </>
                ) : (
                  <i />
                )}
                {g.labelHe}
              </span>
            );
          })}
        </button>
      </section>
      )}
      {place && <StopSheet stop={place.stop} date={place.date} onClose={() => setPlace(null)} />}
    </div>
  );
}
