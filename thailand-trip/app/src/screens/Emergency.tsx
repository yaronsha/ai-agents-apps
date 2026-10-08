import { dayOf, distanceKm, embassyUrl, emergencyNumbers, googleMapsDirections, hospitals, phrases } from "@trip/shared";
import { useTrip } from "../tripContext";
import { Icon } from "../icons";

// Hospital numbers are stored in Thai local format (053-...). Dial them with +66 so they also work
// from an Israeli SIM roaming in Thailand.
const intlPhone = (local: string) => "+66" + local.replace(/-/g, "").replace(/^0/, "");

export function Emergency({ date }: { date: string }) {
  const trip = useTrip();
  const day = dayOf(trip, date)!;
  const here = day.stops[0];
  const nearest = [...hospitals].sort((a, b) => distanceKm(here, a) - distanceKm(here, b));
  // The big button is the tourist police by number, not by list position, so reordering the list can't promote another number.
  const first = emergencyNumbers.find((n) => n.phone === "1155") ?? emergencyNumbers[0];
  const rest = emergencyNumbers.filter((n) => n !== first);

  return (
    <>
      <header className="day-head">
        <h1>חירום</h1>
      </header>

      <a className="sos-main" href={`tel:${first.phone}`}>
        <span>
          <span className="sos-label">{first.labelHe}</span>
          {first.verify && <span className="pill warning">לאמת</span>}
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
                {h.phone && (
                  <>
                    {" · "}
                    <bdi dir="ltr">{h.phone}</bdi>
                  </>
                )}
              </span>
            </span>
            <span className="actions">
              {h.phone && (
                <a className="btn" href={`tel:${intlPhone(h.phone)}`}>
                  חיוג
                </a>
              )}
              <a className="btn" href={googleMapsDirections(h)} target="_blank" rel="noreferrer">
                ניווט
              </a>
            </span>
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
