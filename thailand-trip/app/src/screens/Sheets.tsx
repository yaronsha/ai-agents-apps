import { useEffect, useRef, type ReactNode } from "react";
import { googleMapsDirections, hhmm, placeFacts, placeInfo, thDate, type PlaceFacts, type LatLng, type Lodging, type Reminder, type Stop } from "@trip/shared";
import { shortDay } from "../format";
import { Icon } from "../icons";

/**
 * A card that rises from the bottom of the screen. Built on <dialog>, so the browser keeps focus inside it,
 * makes the page behind it inert, closes it on Escape and puts focus back where it was.
 */
export function Sheet({ label, onClose, actions, children }: { label: string; onClose: () => void; actions?: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-label={label}
      onClose={onClose}
      // A tap on the dimmed area outside the card lands on the dialog itself.
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
    >
      <div className="sheet-grab" aria-hidden />
      <button className="sheet-close" aria-label="סגירה" onClick={() => ref.current?.close()}>
        <Icon name="close" size={18} />
      </button>
      <div className="sheet-body">{children}</div>
      {actions && <div className="sheet-actions">{actions}</div>}
    </dialog>
  );
}

function when(date: string): string {
  return date === thDate(new Date()) ? "היום" : `ב-${shortDay(date)}`;
}

function PlaceActions({ at, onMap }: { at: LatLng; onMap?: () => void }) {
  return (
    <>
      <a className="btn primary" href={googleMapsDirections(at)} target="_blank" rel="noreferrer">
        <Icon name="nav" size={18} />
        ניווט
      </a>
      {onMap && (
        <button className="btn" onClick={onMap}>
          <Icon name="map" size={18} />
          על המפה
        </button>
      )}
    </>
  );
}

function Reminders({ reminders }: { reminders: Reminder[] }) {
  return reminders.map((r) => (
    <p className="sheet-reminder" key={r.id}>
      <strong>
        תזכורת <bdi dir="ltr">{hhmm(r.at)}</bdi>:
      </strong>{" "}
      {r.textHe}
    </p>
  ));
}

const WEEKDAYS_HE = ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "ש'"];

/** Hours, fees, payment and local rules, as gathered before the trip, with the date they were checked. */
function Facts({ facts }: { facts: PlaceFacts }) {
  const hours = facts.hoursHe ?? (facts.hours && `${facts.hours.open}-${facts.hours.close}`);
  const rows: Array<[string, string | undefined]> = [
    ["שעות", hours && (facts.hours?.lastEntry && !facts.hoursHe ? `${hours} (כניסה אחרונה ${facts.hours.lastEntry})` : hours)],
    ["סגור", facts.closedOn && (facts.closedNoteHe ?? `בימי ${facts.closedOn.map((d) => WEEKDAYS_HE[d]).join(", ")}`)],
    ["כניסה", facts.feeHe],
    ["תשלום", facts.payHe],
  ];
  const [y, m, d] = facts.checked.split("-");
  return (
    <>
      <h3>כדאי לדעת מראש</h3>
      <dl className="sheet-facts">
        {rows
          .filter((r): r is [string, string] => Boolean(r[1]))
          .map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
      {facts.notesHe && (
        <ul>
          {facts.notesHe.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
      <p className="sheet-source">
        נבדק ב-{`${Number(d)}.${Number(m)}.${y}`} ממדריכי טיולים וחדשות, ולא מול המקום עצמו.
        {facts.officialUrls?.map((u) => (
          <span key={u}>
            {" "}
            <a href={u} target="_blank" rel="noreferrer" dir="ltr">
              {new URL(u).hostname.replace(/^www\./, "")}
            </a>
          </span>
        ))}
      </p>
    </>
  );
}

export function StopSheet({
  stop,
  date,
  reminders = [],
  onClose,
  onMap,
}: {
  stop: Stop;
  date: string;
  /** Reminders before this stop, also shown here for anyone without push notifications. */
  reminders?: Reminder[];
  onClose: () => void;
  onMap?: () => void;
}) {
  const info = placeInfo(stop.id);
  const facts = placeFacts(stop.id);
  return (
    <Sheet label={stop.nameHe} onClose={onClose} actions={<PlaceActions at={stop} onMap={onMap} />}>
      <h2>{stop.nameHe}</h2>
      <p className="sheet-alt">
        <span lang="en">{stop.nameEn}</span>
        {info?.nameTh && (
          <>
            {" · "}
            <span lang="th">{info.nameTh}</span>
          </>
        )}
      </p>
      {info && <p className="sheet-lede">{info.aboutHe}</p>}
      <p className="sheet-plan">
        <strong>
          {when(date)} <bdi dir="ltr">{hhmm(stop.start)}–{hhmm(stop.end)}</bdi>.
        </strong>
        {stop.noteHe && ` ${stop.noteHe}`}
      </p>
      <Reminders reminders={reminders} />
      {info?.tipsHe && (
        <>
          <h3>לפני שהולכים</h3>
          <ul>
            {info.tipsHe.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </>
      )}
      {facts && <Facts facts={facts} />}
    </Sheet>
  );
}

export function LodgingSheet({
  lodging,
  reminders = [],
  onClose,
  onMap,
}: {
  lodging: Lodging;
  /** The evening's reminders (after the last stop), also shown here for anyone without push notifications. */
  reminders?: Reminder[];
  onClose: () => void;
  onMap?: () => void;
}) {
  return (
    <Sheet label={lodging.name} onClose={onClose} actions={<PlaceActions at={lodging} onMap={onMap} />}>
      <h2>{lodging.name}</h2>
      <p className="sheet-alt">לינה</p>
      <p className="sheet-plan">
        <strong>
          מגיעים <bdi>{shortDay(lodging.checkIn)}</bdi>, עוזבים <bdi>{shortDay(lodging.checkOut)}</bdi>.
        </strong>
      </p>
      <Reminders reminders={reminders} />
    </Sheet>
  );
}

/** "גשם בשקיעה: לצפות מ..." shows as a bold situation and what to do about it. */
function splitOption(p: string): [string | null, string] {
  const i = p.indexOf(": ");
  return i > 0 && i < 60 ? [p.slice(0, i), p.slice(i + 2)] : [null, p];
}

export function PlanBSheet({ date, planB, onClose, onReplan }: { date: string; planB: string[]; onClose: () => void; onReplan: () => void }) {
  return (
    <Sheet
      label="תוכנית ב'"
      onClose={onClose}
      actions={
        <button className="btn primary" onClick={onReplan}>
          תכנן לי מחדש
        </button>
      }
    >
      <h2>תוכנית ב' ל-{shortDay(date)}</h2>
      {planB.map((p) => {
        const [situation, what] = splitOption(p);
        return (
          <div className="sheet-option" key={p}>
            {situation && <strong>{situation}</strong>}
            {what}
          </div>
        );
      })}
    </Sheet>
  );
}
