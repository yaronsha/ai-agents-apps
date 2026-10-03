import { dayOf, distanceKm, embassyUrl, emergencyNumbers, googleMapsDirections, hospitals, phrases } from "@trip/shared";
import { useTrip } from "../tripContext";
import { Icon } from "../icons";

export function Emergency({ date }: { date: string }) {
  const trip = useTrip();
  const day = dayOf(trip, date)!;
  const here = day.stops[0];
  const nearest = [...hospitals].sort((a, b) => distanceKm(here, a) - distanceKm(here, b));
  const [first, ...rest] = emergencyNumbers;

  return (
    <>
      <header className="day-head">
        <h1>חירום</h1>
      </header>

      <a className="sos-main" href={`tel:${first.phone}`}>
        <span>
          <span className="sos-label">{first.labelHe}</span>
          <strong dir="ltr">{first.phone}</strong>
        </span>
        <span className="call">
          <Icon name="phone" />
          חיוג
        </span>
      </a>

      <section className="card list">
        {rest.map((n) => (
          <a key={n.phone} className="list-row" href={`tel:${n.phone}`}>
            <span>
              {n.labelHe}
              {n.verify && <span className="pill warning">לאמת</span>}
            </span>
            <span className="num" dir="ltr">
              {n.phone}
            </span>
          </a>
        ))}
      </section>

      <h2 className="section-title">בתי חולים, מהקרוב לתוכנית של היום</h2>
      <section className="card list">
        {nearest.map((h) => (
          <div key={h.name} className="list-row">
            <span className="hosp">
              <bdi>{h.name}</bdi>
              <span className="muted">
                {h.area} · {Math.round(distanceKm(here, h))} ק"מ
              </span>
            </span>
            <a className="btn" href={googleMapsDirections(h)} target="_blank" rel="noreferrer">
              ניווט
            </a>
          </div>
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

      <h2 className="section-title">להראות לנהג</h2>
      <section className="card">
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
