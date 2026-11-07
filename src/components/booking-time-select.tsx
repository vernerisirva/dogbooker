"use client";
import { windowOptions } from "@/lib/time-windows";
export function BookingTimeSelect({
  label,
  value,
  onChange,
  disabled = false,
  window = { start: "06:00", end: "23:00" },
  required = false,
}: {
  label: "Lämningstid" | "Hämtningstid";
  value: string;
  onChange: (time: string) => void;
  disabled?: boolean;
  window?: { start: string; end: string };
  required?: boolean;
}) {
  const options = windowOptions(window);
  return (
    <label>
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={label}
        required={required}
      >
        <option value="" disabled={required}>
          Välj tid
        </option>
        {value && !options.includes(value) && (
          <option value={value} disabled>
            {value} (tidigare vald)
          </option>
        )}
        {options.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <span className="field-hint">
        Tillåtna tider: {window.start}–{window.end}, i steg om 15 minuter.
        Svensk tid.
      </span>
    </label>
  );
}
