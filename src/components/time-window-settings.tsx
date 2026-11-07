"use client";
import { useState, type FormEvent } from "react";
import { arrivalOptions } from "@/lib/arrival-time";
import { type TimeWindows, type WindowSettings } from "@/lib/time-windows";
import { formatDate } from "@/lib/dates";
import { api } from "./owners";
import { errorMessage, localizeValidation, clearValidation } from "@/lib/ui";
const fields: [keyof TimeWindows, string][] = [
  ["arrivalStart", "Lämning från"],
  ["arrivalEnd", "Lämning till"],
  ["pickupStart", "Hämtning från"],
  ["pickupEnd", "Hämtning till"],
];
export function TimeWindowSettings({
  settings,
  onSaved,
}: {
  settings: WindowSettings;
  onSaved: () => Promise<void>;
}) {
  const [defaults, setDefaults] = useState(settings.defaults),
    [exception, setException] = useState(settings.defaults),
    [date, setDate] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(windows: TimeWindows | null, day?: string) {
    setBusy(true);
    setError("");
    try {
      await api("/api/time-windows", "PUT", {
        expectedRevision: settings.revision,
        windows: windows
          ? Object.fromEntries(fields.map(([key]) => [key, windows[key]]))
          : null,
        ...(day ? { date: day } : {}),
      });
      await onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function selectors(value: TimeWindows, set: (w: TimeWindows) => void) {
    return (
      <div className="date-inputs">
        {fields.map(([key, label]) => (
          <label key={key}>
            {label}
            <select
              aria-label={label}
              disabled={busy}
              value={value[key]}
              onChange={(e) => set({ ...value, [key]: e.target.value })}
            >
              {arrivalOptions.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
    );
  }
  return (
    <section className="bookings-section time-window-settings">
      <h2>Tidsfönster</h2>
      <p>
        Välj när hundarna kan lämnas och hämtas. Ett datumundantag ersätter
        standardtiderna för just den dagen. Redan godkända tider ändras inte.
      </p>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      <form
        className="booking-form"
        onInvalid={localizeValidation}
        onInput={clearValidation}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void save(defaults);
        }}
      >
        <h3>Standardtider</h3>
        {selectors(defaults, setDefaults)}
        <button className="button primary" disabled={busy}>
          Spara standardtider
        </button>
      </form>
      <form
        className="booking-form"
        onInvalid={localizeValidation}
        onInput={clearValidation}
        onSubmit={(e) => {
          e.preventDefault();
          void save(exception, date);
        }}
      >
        <h3>Undantag för ett datum</h3>
        <label>
          Datum
          <input
            type="date"
            disabled={busy}
            required
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setException(
                settings.overrides.find((w) => w.date === e.target.value) ??
                  settings.defaults,
              );
            }}
          />
        </label>
        {selectors(exception, setException)}
        <button className="button primary" disabled={busy}>
          Spara datumundantag
        </button>
      </form>
      <h3>Sparade datumundantag</h3>
      {!settings.overrides.length && <p>Inga datumundantag är sparade.</p>}
      {settings.overrides.map((w) => (
        <article className="booking-row" key={w.date}>
          <div className="booking-info">
            <h3>{formatDate(w.date)}</h3>
            <p>
              Lämning {w.arrivalStart}–{w.arrivalEnd} · Hämtning {w.pickupStart}
              –{w.pickupEnd}
            </p>
          </div>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => {
              setDate(w.date);
              setException(w);
            }}
          >
            Ändra undantag
          </button>
          <button
            className="text-button danger-text"
            disabled={busy}
            onClick={() => void save(null, w.date)}
          >
            Ta bort undantag
          </button>
        </article>
      ))}
    </section>
  );
}
