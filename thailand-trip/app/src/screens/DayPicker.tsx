import { useEffect, useRef } from "react";
import { publicTrip as trip, type DayStatus } from "@trip/shared";
import { statusText, weekdayShort } from "../format";

export function DayPicker({ date, setDate, status }: { date: string; setDate: (d: string) => void; status?: Record<string, DayStatus> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [date]);
  return (
    <div className="daypicker" ref={ref} role="toolbar" aria-label="בחירת יום">
      {trip.days.map((d) => {
        const s = status?.[d.date];
        return (
          <button
            key={d.date}
            className="day"
            aria-pressed={d.date === date}
            aria-label={`${d.date.slice(8)}.${Number(d.date.slice(5, 7))}${s ? `, ${statusText[s]}` : ""}`}
            onClick={() => setDate(d.date)}
          >
            {s && s !== "green" && <i className={`flag ${s}`} />}
            <b>{Number(d.date.slice(8))}</b>
            <span>
              {weekdayShort(d.date)} · {Number(d.date.slice(5, 7))}
            </span>
          </button>
        );
      })}
    </div>
  );
}
