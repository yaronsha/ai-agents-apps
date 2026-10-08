import { Fragment, useEffect, useRef } from "react";
import { publicTrip as trip, type DayStatus } from "@trip/shared";
import { shortDay, statusText, weekdayShort } from "../format";

const MONTHS_SHORT = ["ינו׳", "פבר׳", "מרץ", "אפר׳", "מאי", "יוני", "יולי", "אוג׳", "ספט׳", "אוק׳", "נוב׳", "דצמ׳"];

export function DayPicker({ date, setDate, status }: { date: string; setDate: (d: string) => void; status?: Record<string, DayStatus> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [date]);
  return (
    <div className="daypicker" ref={ref} role="group" aria-label="בחירת יום">
      {trip.days.map((d, i) => {
        const s = status?.[d.date];
        const month = d.date.slice(5, 7);
        // The month is named once, where it starts, instead of on every day.
        const newMonth = i === 0 || trip.days[i - 1].date.slice(5, 7) !== month;
        return (
          <Fragment key={d.date}>
            {newMonth && <span className={`month ${i > 0 ? "next" : ""}`}>{MONTHS_SHORT[Number(month) - 1]}</span>}
            <button className="day" aria-pressed={d.date === date} aria-label={`${weekdayShort(d.date)} ${shortDay(d.date)}${s ? `, ${statusText[s]}` : ""}`} onClick={() => setDate(d.date)}>
              {s && s !== "green" && <i className={`flag ${s}`} />}
              <span className="wd">{weekdayShort(d.date)}</span>
              <b>{Number(d.date.slice(8))}</b>
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}
