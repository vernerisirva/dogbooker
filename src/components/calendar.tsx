"use client";
import { sv } from "@/lib/swedish";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, formatDate, monthBounds } from "@/lib/dates";
import type { CalendarEntry } from "@/lib/booking-service";
import { calendarDay, type CalendarAction } from "@/lib/calendar-availability";
export function MonthCalendar({
  month,
  today,
  entries,
  start,
  end,
  admin,
  ownerId,
  action,
  editingId,
  onMonth,
  onSelect,
  loading,
}: {
  month: string;
  today: string;
  entries: CalendarEntry[];
  start: string;
  end: string;
  admin: boolean;
  ownerId?: string;
  action?: CalendarAction;
  editingId?: string;
  onMonth: (month: string) => void;
  onSelect: (day: string) => void;
  loading: boolean;
}) {
  const { start: first, end: last } = monthBounds(month);
  const weekday = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const days = Array.from(
    { length: Math.ceil((weekday + Number(last.slice(8))) / 7) * 7 },
    (_, i) => addDays(first, i - weekday),
  );
  const move = (n: number) => {
    const d = new Date(`${first}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    onMonth(d.toISOString().slice(0, 7));
  };
  return (
    <section
      className="calendar-card"
      aria-label="Kalender för tillgänglighet"
      aria-busy={loading}
    >
      <div className="calendar-toolbar">
        <div>
          <h2>{formatDate(first, { month: "long", year: "numeric" })}</h2>
          <p className="calendar-sub">Lite planering, många glada svansar.</p>
        </div>
        <div className="month-controls">
          <button
            className="text-button today-button"
            onClick={() => onMonth(today.slice(0, 7))}
          >
            Idag
          </button>
          <button
            className="icon-button"
            aria-label={sv.previousMonth}
            onClick={() => move(-1)}
          >
            <ChevronLeft size={20} />
          </button>
          <button
            className="icon-button"
            aria-label={sv.nextMonth}
            onClick={() => move(1)}
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </div>
      <div className="weekdays" aria-hidden="true">
        {["MÅN", "TIS", "ONS", "TOR", "FRE", "LÖR", "SÖN"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className={"calendar-grid" + (loading ? " is-loading" : "")}>
        {days.map((day) => {
          const info = calendarDay(entries, day, {
            admin,
            ownerId,
            action,
            editingId,
          });
          const outside = day.slice(0, 7) !== month,
            past = day < today,
            selected = start && day >= start && day <= (end || start);
          return (
            <button
              key={day}
              type="button"
              data-date={day}
              className={`day ${outside ? "outside" : ""} ${past ? "past" : ""} ${info.style} ${selected ? "selected" : ""} ${day === today ? "is-today" : ""}`}
              disabled={outside || past || info.unavailable || loading}
              aria-label={`${formatDate(day, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}, ${info.label}${selected ? ", valt" : ""}`}
              aria-pressed={!!selected}
              onClick={() => onSelect(day)}
            >
              <span className="day-number">{Number(day.slice(8))}</span>
              {!outside && info.shortLabel && (
                <span className="day-status">{info.shortLabel}</span>
              )}
              {!outside && !info.shortLabel && !past && (
                <span className="available-dot" />
              )}
            </button>
          );
        })}
      </div>
      <div className="calendar-footer">
        <div className="legend">
          <span>
            <i className="available" />
            {sv.available}
          </span>
          <span>
            <i className="unavailable" />
            {sv.unavailable}
          </span>
          <span>
            <i className="mine" />
            Godkänd vistelse
          </span>
          <span>
            <i className="both" />
            Flera hundar
          </span>
          <span>
            <i className="pending" />
            Väntar på godkännande
          </span>
        </div>
        <span className="timezone">Svensk tid</span>
      </div>
    </section>
  );
}
