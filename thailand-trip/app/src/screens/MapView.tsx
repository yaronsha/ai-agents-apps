import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { dayOf, hhmm, hospitals, placeOf, publicTrip, googleMapsDirections } from "@trip/shared";
import { useTrip } from "../tripContext";
import type { Live } from "../App";
import { dayLabel, severityText, shortDay } from "../format";
import { GROUPS, worstOf } from "../categories";
import { Icon } from "../icons";

const dayColor = (i: number) => `hsl(${(i * 360) / publicTrip.days.length + 170}, 62%, 38%)`;

export function MapView({ date, setDate, live, openAlerts }: { date: string; setDate: (d: string) => void; live: Live; openAlerts: () => void }) {
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

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { zoomControl: false }).setView([19.3, 99.2], 8);
    L.control.zoom({ position: "topleft" }).addTo(map.current);
    // CARTO Voyager draws OpenStreetMap with English place names (the standard OSM tiles are in Thai).
    // crossOrigin lets the service worker cache the tiles for offline use; an opaque reply is not cached.
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd",
      maxZoom: 19,
      crossOrigin: true,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map.current);
    layers.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = layers.current;
    if (!m || !g) return;
    g.clearLayers();
    const alerted = new Set(live.state?.alerts.filter((a) => a.stopId && a.severity !== "info").map((a) => a.stopId));
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
          html: `<div class="pin ${selected ? "sel" : ""} ${alerted.has(s.id) ? "warn" : ""}" style="--c:${color}">${selected ? n + 1 : ""}</div>`,
          iconSize: selected ? [26, 26] : [12, 12],
          iconAnchor: selected ? [13, 13] : [6, 6],
        });
        L.marker([s.lat, s.lng], { icon, zIndexOffset: selected ? 1000 : 0 })
          .bindPopup(
            `<b>${s.nameHe}</b><br>${shortDay(day.date)} · ${hhmm(s.start)}${s.noteHe ? `<br><small>${s.noteHe}</small>` : ""}<br><a href="${googleMapsDirections(s)}" target="_blank">ניווט</a>`,
          )
          .on("click", () => day.date !== date && setDate(day.date))
          .addTo(g);
      });
      if (selected && path.length) focus.current = L.latLngBounds(path);
    });

    trip.lodgings.forEach((l) =>
      L.marker([l.lat, l.lng], { icon: L.divIcon({ className: "", html: '<div class="pin-hotel">⌂</div>', iconSize: [20, 20], iconAnchor: [10, 10] }) })
        .bindPopup(`<b>${l.name}</b><br>${shortDay(l.checkIn)}–${shortDay(l.checkOut)}`)
        .addTo(g),
    );

    if (showHospitals) {
      hospitals.forEach((h) =>
        L.marker([h.lat, h.lng], { icon: L.divIcon({ className: "", html: '<div class="pin-hospital">✚</div>', iconSize: [20, 20], iconAnchor: [10, 10] }) })
          .bindPopup(`<b>${h.name}</b><br>${h.area}<br><a href="${googleMapsDirections(h)}" target="_blank">ניווט</a>`)
          .addTo(g),
      );
    }
    fitDay();
  }, [date, showHospitals, live.state, setDate, trip]);

  /** Frames the selected day's route between the map buttons and the day card. */
  function fitDay() {
    const m = map.current;
    if (!m || !focus.current) return;
    const above = (tools.current?.offsetHeight ?? 0) + 20;
    const below = (sheet.current?.offsetHeight ?? 0) + 36;
    m.fitBounds(focus.current, { paddingTopLeft: [40, above], paddingBottomRight: [40, below], maxZoom: 12 });
  }

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

  const day = dayOf(trip, date)!;
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
                <i />
                {g.labelHe}
              </span>
            );
          })}
        </button>
      </section>
    </div>
  );
}
