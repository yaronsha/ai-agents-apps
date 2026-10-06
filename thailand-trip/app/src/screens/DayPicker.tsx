import { useEffect, useRef } from "react";
import { publicTrip as trip, type DayStatus } from "@trip/shared";
import { shortDay } from "../format";

export function DayPicker({ date, setDate, status }: { date: string; setDate: (d: string) => void; status?: Record<string, DayStatus> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector(".chip.active")?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [date]);
  return (
    <div className="daypicker" ref={ref}>
      {trip.days.map((d) => (
        <button key={d.date} className={`chip ${d.date === date ? "active" : ""}`} onClick={() => setDate(d.date)}>
          <span className={`status-dot ${status?.[d.date] ?? "none"}`} />
          {shortDay(d.date)}
        </button>
      ))}
    </div>
  );
}
