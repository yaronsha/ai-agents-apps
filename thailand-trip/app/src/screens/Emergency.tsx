import { dayOf, distanceKm, embassyUrl, emergencyNumbers, googleMapsDirections, hospitals, phrases } from "@trip/shared";
import { useTrip } from "../tripContext";

export function Emergency({ date }: { date: string }) {
  const trip = useTrip();
  const day = dayOf(trip, date)!;
  const here = day.stops[0];
  const nearest = [...hospitals].sort((a, b) => distanceKm(here, a) - distanceKm(here, b));

  return (
    <>
      <header className="day-head">
        <h1>חירום</h1>
      </header>
      <section className="sos-grid">
        {emergencyNumbers.map((n) => (
          <a key={n.phone} className="sos" href={`tel:${n.phone}`}>
            <strong>{n.phone}</strong>
            <span>
              {n.labelHe}
              {n.verify ? " (לאמת)" : ""}
            </span>
          </a>
        ))}
      </section>

      <section className="card">
        <h2>בתי חולים, מהקרוב לתוכנית של היום</h2>
        {nearest.map((h) => (
          <p key={h.name}>
            {h.name} · {h.area} · {Math.round(distanceKm(here, h))} ק"מ ·{" "}
            <a href={googleMapsDirections(h)} target="_blank" rel="noreferrer">
              ניווט
            </a>
          </p>
        ))}
      </section>

      <section className="card">
        <h2>שגרירות ישראל בבנגקוק</h2>
        <p>
          <a href={embassyUrl} target="_blank" rel="noreferrer">
            פרטי קשר באתר השגרירות
          </a>
        </p>
      </section>

      <section className="card">
        <h2>להראות לנהג</h2>
        {phrases.map((p) => (
          <div key={p.th} className="phrase">
            <div className="th" lang="th" dir="ltr">
              {p.th}
            </div>
            <div className="muted">{p.he}</div>
          </div>
        ))}
      </section>
    </>
  );
}
