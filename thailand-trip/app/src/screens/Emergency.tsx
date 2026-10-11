import { useEffect, useState } from "react";
import type { LatLng } from "@trip/shared";
import { dayOf, embassyUrl, emergencyNumbers, googleMapsDirections, hospitalsByDistance, phrases } from "@trip/shared";
import { useTrip } from "../tripContext";
import { Icon } from "../icons";

// Hospital numbers are stored in Thai local format (053-...). Dial them with +66 so they also work
// from an Israeli SIM roaming in Thailand.
const intlPhone = (local: string) => "+66" + local.replace(/-/g, "").replace(/^0/, "");

type Locating = "idle" | "locating" | "failed";

/**
 * The phone's position for sorting hospitals. Asks only on a tap, unless location was already allowed,
 * in which case it locates as soon as the screen opens: in an emergency nobody should have to find a button.
 */
function useMyPosition() {
  const [pos, setPos] = useState<LatLng | null>(null);
  const [status, setStatus] = useState<Locating>("idle");

  const locate = () => {
    if (!navigator.geolocation) return setStatus("failed");
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
        setStatus("idle");
      },
      () => setStatus("failed"),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };

  useEffect(() => {
    navigator.permissions
      ?.query({ name: "geolocation" })
      .then((p) => p.state === "granted" && locate())
      .catch(() => {});
  }, []);

  return { pos, status, locate };
}

export function Emergency({ date }: { date: string }) {
  const trip = useTrip();
  const day = dayOf(trip, date)!;
  const me = useMyPosition();
  // Without the phone's position, fall back to the day's first stop.
  const nearest = hospitalsByDistance(me.pos ?? day.stops[0]);
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
              {n.display ?? n.phone}
            </span>
          </a>
        ))}
      </section>

      <div className="section-head">
        <h2 className="section-title">{me.pos ? "בתי חולים, מהקרוב למיקום שלי" : "בתי חולים, מהקרוב לתוכנית של היום"}</h2>
        <button className="btn" onClick={me.locate} disabled={me.status === "locating"}>
          {me.status === "locating" ? "מאתר..." : me.pos ? "רענון מיקום" : "לפי המיקום שלי"}
        </button>
      </div>
      {me.status === "failed" && !me.pos && <p className="muted">לא הצלחנו לאתר את המיקום, אז הרשימה לפי התוכנית של היום.</p>}
      <section className="card list">
        {nearest.map((h) => (
          <div key={h.name} className="list-row">
            <span className="hosp">
              <bdi>{h.name}</bdi>
              <span className="muted">
                {h.area} · {Math.round(h.km)} ק"מ
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
