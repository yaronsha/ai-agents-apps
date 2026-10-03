import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { hhmm, hospitals, placeOf, trip, googleMapsDirections } from "@trip/shared";
import type { Live } from "../App";
import { DayPicker } from "./DayPicker";
import { shortDay } from "../format";

const dayColor = (i: number) => `hsl(${(i * 360) / trip.days.length + 170}, 62%, 38%)`;

export function MapView({ date, setDate, live }: { date: string; setDate: (d: string) => void; live: Live }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<L.LayerGroup | null>(null);
  const [showHospitals, setShowHospitals] = useState(false);
  const [locating, setLocating] = useState(false);
  const me = useRef<L.CircleMarker | null>(null);

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { zoomControl: false }).setView([19.3, 99.2], 8);
    L.control.zoom({ position: "bottomleft" }).addTo(map.current);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
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
    let focus: L.LatLngBounds | null = null;

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
      if (selected && path.length) focus = L.latLngBounds(path);
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
    if (focus) m.fitBounds(focus, { padding: [40, 40], maxZoom: 12 });
  }, [date, showHospitals, live.state, setDate]);

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

  return (
    <div className="map-screen">
      <DayPicker date={date} setDate={setDate} status={live.state?.dayStatus} />
      <div className="map" ref={el} />
      <div className="map-tools">
        <button onClick={locate}>{locating ? "מאתר..." : "איפה אני"}</button>
        <button className={showHospitals ? "on" : ""} onClick={() => setShowHospitals((v) => !v)}>
          בתי חולים
        </button>
      </div>
    </div>
  );
}
