"use client";
import Link from "next/link";
import { useHydrated } from "../../src/components/use-hydrated";
import { useState, useRef, type FormEvent } from "react";
import {
  PawPrint,
  MapPin,
  ArrowRight,
  Search,
  CalendarDays,
  Check,
} from "lucide-react";
import type { dashboard } from "../lib/service";
import type { rankSitters } from "../lib/matching";
import type { SearchInput } from "../lib/validation";
import { addDays, dayCount, formatRange } from "../lib/dates";
import {
  Checks,
  DogFields,
  SitterFields,
  NumberField,
  formString,
  formNumber,
  dogInput,
  sitterInput,
  sizeNames,
  serviceNames,
  preferenceNames,
} from "./forms";
type State = Awaited<ReturnType<typeof dashboard>>;
type Results = ReturnType<typeof rankSitters>;
async function api<T>(path: string, input?: unknown): Promise<T> {
  const r = await fetch(path, {
    method: input === undefined ? "GET" : "POST",
    headers:
      input === undefined ? undefined : { "Content-Type": "application/json" },
    body: input === undefined ? undefined : JSON.stringify(input),
    cache: "no-store",
  });
  const data = await r.json();
  if (!r.ok)
    throw new Error(data.error?.message ?? data.error ?? "Något gick fel.");
  return data;
}
function Brand() {
  return (
    <Link className="brand" href="/">
      <span className="brand-mark">
        <PawPrint size={24} />
      </span>
      <span>
        DogBooker<small>GLADA HUNDAR. VARJE DAG.</small>
      </span>
    </Link>
  );
}
function Demo() {
  return (
    <div className="demo-note">
      Lokal demo · fiktiva profiler · inga betalningar
    </div>
  );
}
export function Login() {
  const hydrated = useHydrated();
  const [signup, setSignup] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      await api(`/api/auth/${signup ? "sign-up" : "sign-in"}/email`, {
        email: f.get("email"),
        password: f.get("password"),
        ...(signup ? { name: f.get("name") } : {}),
      });
      window.location.assign("/");
    } catch {
      setError(
        "Inloggningen misslyckades. Använd ett demokonto med @example.test och minst 12 tecken i lösenordet.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Demo />
      <header className="top">
        <Brand />
      </header>
      <main className="login-layout">
        <div>
          <p className="eyebrow">ETT ANDRA HEM</p>
          <h1>
            En hundvakt som
            <br />
            passar just din hund.
          </h1>
          <p className="lede">
            Lugn hemmiljö eller långa promenader? Börja med hundens behov och
            hitta någon som passar.
          </p>
          <div className="promise">
            <PawPrint size={45} />
            <span>
              Rätt omsorg.
              <br />
              Ett tryggare val.
            </span>
          </div>
        </div>
        <section className="panel login">
          <h2>{signup ? "Skapa ett demokonto" : "Välkommen tillbaka"}</h2>
          <p>Utforska hundpassning i Stockholm med syntetiska uppgifter.</p>
          <form
            method="post"
            inert={!hydrated}
            data-ready={hydrated}
            onSubmit={submit}
          >
            {signup && (
              <label>
                Ditt namn
                <input name="name" required maxLength={80} />
              </label>
            )}
            <label>
              E-postadress
              <input
                name="email"
                type="email"
                required
                autoComplete="username"
                placeholder="alva@example.test"
                pattern=".+@example\.test"
              />
            </label>
            <label>
              Lösenord
              <input
                name="password"
                type="password"
                required
                minLength={12}
                maxLength={128}
                autoComplete={signup ? "new-password" : "current-password"}
              />
            </label>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy || !hydrated}>
              {busy ? "Ett ögonblick…" : signup ? "Skapa konto" : "Logga in"}
              <ArrowRight size={17} />
            </button>
          </form>
          <button
            className="text-button"
            onClick={() => {
              setSignup(!signup);
              setError("");
            }}
          >
            {signup
              ? "Har du redan ett konto? Logga in"
              : "Skapa ett nytt demokonto"}
          </button>
          <p className="hint">
            Endast adresser med @example.test. Använd inga riktiga
            personuppgifter.
          </p>
        </section>
      </main>
    </>
  );
}
export function Marketplace({
  initial,
  user,
  today,
}: {
  initial: State;
  user: { name: string };
  today: string;
}) {
  const hydrated = useHydrated();
  const [state, setState] = useState(initial),
    [tab, setTab] = useState("search"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [results, setResults] = useState<Results | null>(null),
    [query, setQuery] = useState<SearchInput | null>(null);
  const keys = useRef(new Map<string, string>());
  async function refresh() {
    const d = await api<State>("/api/marketplace/me");
    setState(d);
  }
  async function run(work: () => Promise<void>, success = "") {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
      setMessage(success);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Något gick fel.");
    } finally {
      setBusy(false);
    }
  }
  function save(
    e: FormEvent<HTMLFormElement>,
    resource: string,
    make: (f: FormData) => unknown,
    success: string,
  ) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void run(async () => {
      await api(`/api/marketplace/${resource}`, make(f));
      await refresh();
      setResults(null);
    }, success);
  }
  function find(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const p = {
      startDate: formString(f, "startDate"),
      endDate: formString(f, "endDate"),
      latitude: formNumber(f, "latitude"),
      longitude: formNumber(f, "longitude"),
      dogIds: f.getAll("dogIds").map(String),
    };
    void run(async () => {
      const r = await api<Results>("/api/marketplace/search", p);
      setQuery(p);
      setResults(r);
      keys.current.clear();
    });
  }
  async function book(sitterId: string, expectedDailyPrice: number) {
    if (!query) return;
    await run(async () => {
      const key = keys.current.get(sitterId) ?? crypto.randomUUID();
      keys.current.set(sitterId, key);
      await api("/api/marketplace/bookings", {
        ...query,
        sitterId,
        expectedDailyPrice,
        requestKey: key,
      });
      await refresh();
      setResults(null);
      setTab("bookings");
    }, "Förfrågan är skickad. Platserna är reserverade medan hundvakten svarar.");
  }
  return (
    <>
      <Demo />
      <header className="top">
        <Brand />
        <div className="account">
          <span>{user.name}</span>
          <button
            onClick={() =>
              void run(async () => {
                await api("/api/auth/sign-out", {});
                window.location.assign("/");
              })
            }
          >
            Logga ut
          </button>
        </div>
      </header>
      <nav className="tabs" aria-label="Huvudnavigation">
        {[
          ["search", "Hitta hundvakt"],
          ["dogs", "Mina hundar"],
          ["bookings", "Mina bokningar"],
          ["sitter", "Min hundvaktsprofil"],
        ].map(([key, label]) => (
          <button
            key={key}
            aria-current={tab === key ? "page" : undefined}
            onClick={() => {
              setTab(key);
              setMessage("");
              setError("");
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      <main className="shell">
        {error && (
          <div role="alert" className="notice error">
            {error}
          </div>
        )}
        {message && (
          <div role="status" className="notice success">
            <Check size={18} />
            {message}
          </div>
        )}
        {tab === "search" && (
          <>
            <div className="intro">
              <div>
                <p className="eyebrow">HUNDPASSNING PÅ DINA VILLKOR</p>
                <h1>Ett hem att längta till.</h1>
                <p className="lede">
                  Hitta en hundvakt utifrån plats, datum och dina hundars behov.
                </p>
              </div>
              <div className="intro-mark">
                <PawPrint size={64} strokeWidth={1} />
              </div>
            </div>
            <div className="search-layout">
              <aside className="panel search-panel">
                <h2>Vem behöver passning?</h2>
                {!state.dogs.length ? (
                  <>
                    <p>
                      Lägg till din första hund för att hitta rätt hundvakt.
                    </p>
                    <button className="primary" onClick={() => setTab("dogs")}>
                      Lägg till hund
                    </button>
                  </>
                ) : (
                  <form
                    method="post"
                    inert={!hydrated}
                    data-ready={hydrated}
                    onSubmit={find}
                  >
                    <Checks
                      name="dogIds"
                      title="Välj en eller flera hundar"
                      options={Object.fromEntries(
                        state.dogs.map((d) => [d.id, d.name]),
                      )}
                      values={[state.dogs[0].id]}
                    />
                    <label>
                      Från
                      <input
                        type="date"
                        name="startDate"
                        required
                        min={today}
                        max={addDays(today, 365)}
                        defaultValue={addDays(today, 7)}
                      />
                    </label>
                    <label>
                      Till och med
                      <input
                        type="date"
                        name="endDate"
                        required
                        min={today}
                        max={addDays(today, 365)}
                        defaultValue={addDays(today, 9)}
                      />
                    </label>
                    <p className="hint">
                      Båda dagarna räknas. Högst 31 dagar, svensk tid.
                    </p>
                    <div className="form-grid">
                      <NumberField
                        name="latitude"
                        label="Latitud"
                        value={59.33}
                        min={-90}
                        max={90}
                        step="0.01"
                      />
                      <NumberField
                        name="longitude"
                        label="Longitud"
                        value={18.07}
                        min={-180}
                        max={180}
                        step="0.01"
                      />
                    </div>
                    <p className="hint">
                      Stockholm är förvalt. Ange en ungefärlig plats; ingen
                      hemadress behövs.
                    </p>
                    <button className="primary" disabled={busy || !hydrated}>
                      <Search size={17} />
                      {busy ? "Söker…" : "Hitta hundvakter"}
                    </button>
                  </form>
                )}
              </aside>
              <section aria-label="Sökresultat" className="results">
                <div className="section-heading">
                  <h2>
                    {results
                      ? `${results.matches.length} hundvakter som passar`
                      : "Omsorg börjar med rätt matchning"}
                  </h2>
                  {results && <span className="pill">Personlig sortering</span>}
                </div>
                {!results ? (
                  <div className="empty">
                    <PawPrint size={38} />
                    <h3>Små behov gör stor skillnad.</h3>
                    <p>
                      Vi kontrollerar datum, plats, storlek och omsorg. Du ser
                      varför varje hundvakt passar innan du skickar en
                      förfrågan.
                    </p>
                  </div>
                ) : (
                  <>
                    {query && (
                      <p className="hint">
                        {formatRange(query.startDate, query.endDate)} ·{" "}
                        {query.dogIds.length} hundar · avstånd är ungefärliga
                      </p>
                    )}
                    {results.matches.map((m, index) => (
                      <article className="panel sitter-card" key={m.sitter.id}>
                        <div className="card-heading">
                          <div className="avatar">
                            {m.sitter.name.slice(0, 1)}
                          </div>
                          <div>
                            <p className="eyebrow">
                              {index === 0
                                ? "HÖGST MATCHNING"
                                : "PASSAR DINA BEHOV"}
                            </p>
                            <h3>{m.sitter.name}</h3>
                            <p className="location">
                              <MapPin size={14} />
                              {m.sitter.area} · {m.distanceKm} km
                            </p>
                          </div>
                          <div className="score">
                            {Math.round(m.score)}
                            <small>matchpoäng</small>
                          </div>
                        </div>
                        <p>{m.sitter.description}</p>
                        <div className="pills">
                          <span className="pill">
                            {m.sitter.experience_years} års erfarenhet
                          </span>
                          <span className="pill">
                            {m.sitter.resident_dogs
                              ? "Egna hundar i hemmet"
                              : "Inga egna hundar"}
                          </span>
                        </div>
                        <details>
                          <summary>Visa profil och varför ni passar</summary>
                          <ul>
                            {m.explanations.map((x) => (
                              <li key={x}>{x}</li>
                            ))}
                          </ul>
                          <p>
                            Storlekar:{" "}
                            {m.sitter.sizes
                              .map(
                                (s) => sizeNames[s as keyof typeof sizeNames],
                              )
                              .join(", ")}
                            . Högst {m.sitter.capacity} gästande hundar.
                          </p>
                          <p>
                            Omsorg:{" "}
                            {m.sitter.services
                              .map(
                                (s) =>
                                  serviceNames[s as keyof typeof serviceNames],
                              )
                              .join(", ") || "Grundläggande omsorg"}
                            .
                          </p>
                          <p>
                            Miljö:{" "}
                            {m.sitter.preferences
                              .map(
                                (s) =>
                                  preferenceNames[
                                    s as keyof typeof preferenceNames
                                  ],
                              )
                              .join(", ") || "Inga särskilda uppgifter"}
                            .
                          </p>
                          <dl className="factors">
                            {Object.entries(m.factors).map(([k, v]) => (
                              <div key={k}>
                                <dt>
                                  {
                                    {
                                      distance: "Avstånd",
                                      price: "Pris",
                                      experience: "Erfarenhet",
                                      preferences: "Önskemål",
                                    }[k]
                                  }
                                </dt>
                                <dd>{Math.round(v * 100)}/100</dd>
                              </div>
                            ))}
                          </dl>
                          <p className="hint">
                            Poängen är en jämförelse, ingen säkerhetsgaranti.
                            Erfarenhet är självrapporterad.
                          </p>
                        </details>
                        <div className="card-footer">
                          <div>
                            <strong>{m.sitter.daily_price / 100} kr</strong>
                            <span> / hund och dag</span>
                            {query && (
                              <p>
                                {(m.sitter.daily_price / 100) *
                                  dayCount(query.startDate, query.endDate) *
                                  query.dogIds.length}{" "}
                                kr totalt · demo
                              </p>
                            )}
                          </div>
                          <button
                            className="primary"
                            disabled={busy || !hydrated}
                            onClick={() =>
                              void book(m.sitter.id, m.sitter.daily_price)
                            }
                          >
                            Skicka förfrågan <ArrowRight size={16} />
                          </button>
                        </div>
                        <p className="hint">
                          Dina valda hundars omsorgsanteckningar delas med denna
                          hundvakt när du skickar.
                        </p>
                      </article>
                    ))}
                    {results.matches.length === 0 && (
                      <div className="empty">
                        <h3>Ingen hundvakt passar just nu.</h3>
                        <p>Prova andra datum eller en annan plats.</p>
                      </div>
                    )}
                    {results.excluded.length > 0 && (
                      <details className="panel">
                        <summary>Varför visas inte alla hundvakter?</summary>
                        {results.excluded.map((x) => (
                          <p key={x.sitterId}>
                            <strong>{x.name}:</strong> {x.reasons.join(" ")}
                          </p>
                        ))}
                      </details>
                    )}
                  </>
                )}
              </section>
            </div>
          </>
        )}
        {tab === "dogs" && (
          <>
            <div className="intro">
              <div>
                <p className="eyebrow">MINA HUNDAR</p>
                <h1>Alla i familjen får plats.</h1>
                <p className="lede">
                  Behov styr matchningen. Anteckningar är privata.
                </p>
              </div>
            </div>
            <div className="manage-grid">
              {state.dogs.map((d) => (
                <details className="panel" key={d.id}>
                  <summary>
                    <strong>{d.name}</strong> · {sizeNames[d.size]} ·{" "}
                    {d.age_years} år
                  </summary>
                  <form
                    method="post"
                    inert={!hydrated}
                    data-ready={hydrated}
                    onSubmit={(e) =>
                      save(
                        e,
                        "dogs",
                        (f) => dogInput(f, d.id),
                        "Hundprofilen är sparad.",
                      )
                    }
                  >
                    <DogFields dog={d} />
                    <button className="primary" disabled={busy || !hydrated}>
                      Spara {d.name}
                    </button>
                  </form>
                </details>
              ))}
              <section className="panel">
                <h2>Lägg till en hund</h2>
                <form
                  method="post"
                  inert={!hydrated}
                  data-ready={hydrated}
                  onSubmit={(e) =>
                    save(e, "dogs", dogInput, "Hunden är tillagd.")
                  }
                >
                  <DogFields />
                  <button className="primary" disabled={busy || !hydrated}>
                    Spara hund
                  </button>
                </form>
              </section>
            </div>
          </>
        )}
        {tab === "bookings" && (
          <>
            <div className="intro">
              <div>
                <p className="eyebrow">MINA BOKNINGAR</p>
                <h1>Kommande tassavtryck.</h1>
                <p className="lede">
                  Dina förfrågningar och din privata hundvaktskalender.
                </p>
              </div>
              <button onClick={() => void run(refresh)}>Uppdatera</button>
            </div>
            {!state.bookings.length ? (
              <div className="empty">
                <CalendarDays size={36} />
                <h2>Inga bokningar ännu</h2>
                <p>När du skickar eller tar emot en förfrågan visas den här.</p>
              </div>
            ) : (
              <div className="booking-list">
                {state.bookings.map((b) => (
                  <article className="panel" key={b.id} data-booking-id={b.id}>
                    <div className="section-heading">
                      <h2>{b.sitterName}</h2>
                      <span className={`pill status-${b.status}`}>
                        {
                          {
                            pending: "Väntar på svar",
                            confirmed: "Godkänd",
                            declined: "Nekad",
                            cancelled: "Avbokad",
                          }[b.status]
                        }
                      </span>
                    </div>
                    <p className="booking-date">
                      {formatRange(b.start_date, b.end_date)}
                    </p>
                    <p>
                      {b.dogs.map((d) => d.name).join(" & ") ||
                        "Omsorgsuppgifterna visas inte längre"}{" "}
                      · {b.total_price / 100} kr totalt (demo)
                    </p>
                    {b.dogs.length > 0 && (
                      <details>
                        <summary>Delade omsorgsuppgifter</summary>
                        {b.dogs.map((d) => (
                          <div key={d.id}>
                            <h3>{d.name}</h3>
                            <p>
                              {sizeNames[d.size]}, {d.age_years} år.{" "}
                              {d.social
                                ? "Kan dela hem med andra hundar."
                                : "Behöver hem utan andra hundar."}
                            </p>
                            <p>
                              {d.requirements
                                .map(
                                  (r) =>
                                    serviceNames[
                                      r as keyof typeof serviceNames
                                    ],
                                )
                                .join(", ")}
                            </p>
                            <p>{d.care_notes || "Inga extra anteckningar."}</p>
                          </div>
                        ))}
                      </details>
                    )}
                    <div className="actions">
                      {b.status === "pending" &&
                        b.canDecide &&
                        [
                          ["confirmed", "Godkänn"],
                          ["declined", "Neka"],
                        ].map(([decision, label]) => (
                          <button
                            key={decision}
                            className={
                              decision === "confirmed" ? "primary" : ""
                            }
                            disabled={busy || !hydrated}
                            onClick={() =>
                              void run(async () => {
                                await api("/api/marketplace/decisions", {
                                  id: b.id,
                                  decision,
                                  revision: b.revision,
                                });
                                await refresh();
                              }, "Bokningen är uppdaterad.")
                            }
                          >
                            {label}
                          </button>
                        ))}
                      {["pending", "confirmed"].includes(b.status) && (
                        <button
                          disabled={busy || !hydrated}
                          onClick={() =>
                            void run(async () => {
                              await api("/api/marketplace/decisions", {
                                id: b.id,
                                decision: "cancelled",
                                revision: b.revision,
                              });
                              await refresh();
                            }, "Bokningen är avbokad och platserna är lediga.")
                          }
                        >
                          Avboka
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
        {tab === "sitter" && (
          <>
            <div className="intro">
              <div>
                <p className="eyebrow">FÖR HUNDVAKTER</p>
                <h1>Ditt hem. Din omsorg.</h1>
                <p className="lede">
                  Berätta vad du kan erbjuda och öppna de dagar som passar dig.
                </p>
              </div>
            </div>
            <div className="manage-grid">
              <section className="panel">
                <h2>Din offentliga profil</h2>
                <form
                  method="post"
                  inert={!hydrated}
                  data-ready={hydrated}
                  onSubmit={(e) =>
                    save(
                      e,
                      "sitter",
                      sitterInput,
                      "Hundvaktsprofilen är sparad.",
                    )
                  }
                >
                  <SitterFields sitter={state.sitter} />
                  <button className="primary" disabled={busy || !hydrated}>
                    Spara profil
                  </button>
                </form>
              </section>
              <section className="panel">
                <h2>Din tillgänglighet</h2>
                {state.sitter ? (
                  <>
                    <p>
                      Öppna eller stäng ett datumintervall. Aktiva bokningar
                      skyddas.
                    </p>
                    <form
                      method="post"
                      inert={!hydrated}
                      data-ready={hydrated}
                      onSubmit={(e) =>
                        save(
                          e,
                          "availability",
                          (f) => ({
                            startDate: f.get("startDate"),
                            endDate: f.get("endDate"),
                            available: f.get("available") === "true",
                          }),
                          "Tillgängligheten är sparad.",
                        )
                      }
                    >
                      <label>
                        Första datum
                        <input
                          type="date"
                          name="startDate"
                          min={today}
                          defaultValue={addDays(today, 7)}
                          required
                        />
                      </label>
                      <label>
                        Sista datum
                        <input
                          type="date"
                          name="endDate"
                          min={today}
                          defaultValue={addDays(today, 9)}
                          required
                        />
                      </label>
                      <label>
                        Tillgänglighet
                        <select name="available">
                          <option value="true">Öppet för förfrågningar</option>
                          <option value="false">Stängt</option>
                        </select>
                      </label>
                      <button className="primary" disabled={busy || !hydrated}>
                        Spara datum
                      </button>
                    </form>
                    <details>
                      <summary>{state.availability.length} öppna dagar</summary>
                      <div className="days">
                        {state.availability.map((day) => (
                          <span className="pill" key={day}>
                            {day}
                          </span>
                        ))}
                      </div>
                    </details>
                    <p className="hint">
                      Förfrågningar och godkända vistelser finns under Mina
                      bokningar. Ingen annan hundvakt kan se dem.
                    </p>
                  </>
                ) : (
                  <p>
                    Spara din profil först, och öppna sedan datum för bokningar.
                  </p>
                )}
              </section>
            </div>
          </>
        )}
      </main>
      <footer>
        DogBooker · Omsorg med omtanke.
        <span>Svensk tid · SEK · Syntetisk demonstration</span>
      </footer>
    </>
  );
}
