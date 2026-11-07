"use client";
import {
  UiError,
  errorMessage,
  localizeValidation,
  clearValidation,
} from "@/lib/ui";
import { sv } from "@/lib/swedish";
import {
  bookingStatusLabel,
  reservesDates,
  type BookingStatus,
} from "@/lib/booking-status";
import { useState, useRef, useEffect, useEffectEvent, FormEvent } from "react";
import {
  CalendarDays,
  PawPrint,
  LogOut,
  ArrowUpRight,
  ArrowRight,
  Check,
  ShieldCheck,
  CalendarCheck,
  Leaf,
  X,
  Clock,
  ChevronRight,
  History,
} from "lucide-react";
import { Brand } from "./brand";
import { useHydrated } from "./use-hydrated";
import { MonthCalendar } from "./calendar";
import { Owners, api, type Owner } from "./owners";
import { Modal } from "./modal";
import { dayCount, formatDate, formatRange, validateRange } from "@/lib/dates";
import type { Actor } from "@/lib/access";
import type { CalendarEntry } from "@/lib/booking-service";
import { comingLabel, sharedStays } from "@/lib/calendar-availability";
import { BookingTimeSelect } from "./booking-time-select";
import { showInUpcoming } from "@/lib/cancellation-visibility";
import { useCancellationWindow } from "./use-cancellation-window";
import { arrivalTimeLabel, bookingTimesError } from "@/lib/arrival-time";
import {
  applicableWindow,
  type WindowSettings,
  type TimeProposal,
} from "@/lib/time-windows";
import { TimeWindowSettings } from "./time-window-settings";
type Booking = {
  id: string;
  startDate: string;
  endDate: string;
  status: BookingStatus;
  cancelledAt?: string | null;
  arrivalTime?: string | null;
  pickupTime?: string | null;
  arrivalRevision?: number;
  timeProposal?: TimeProposal | null;
  arrivalResubmissionRequired?: boolean;
  pickupResubmissionRequired?: boolean;
  canEditArrival?: boolean;
  canEditPickup?: boolean;
  dogName?: string | null;
  ownerId?: string | null;
  ownerName?: string;
  note?: string | null;
};
type Data = {
  actor: Actor;
  today: string;
  serverNow: string;
  month: string;
  entries: CalendarEntry[];
  bookings: Booking[];
  owners: Owner[];
  ownerLimit: number;
  timeWindows: WindowSettings;
};
export function Dashboard({ initial }: { initial: Data }) {
  const hydrated = useHydrated();
  const [data, setData] = useState(initial),
    [tab, setTab] = useState<
      "calendar" | "bookings" | "owners" | "requests" | "history" | "windows"
    >("calendar"),
    [month, setMonth] = useState(initial.month),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [choosingEnd, setChoosingEnd] = useState(false),
    [action, setAction] = useState<"booking" | "block" | "unblock">("booking"),
    [ownerId, setOwnerId] = useState(""),
    [note, setNote] = useState(""),
    [arrivalTime, setArrivalTime] = useState(""),
    [pickupTime, setPickupTime] = useState(""),
    [proposalMode, setProposalMode] = useState(false),
    [timeBooking, setTimeBooking] = useState<Booking | null>(null),
    [changedArrivalTime, setChangedArrivalTime] = useState(""),
    [changedPickupTime, setChangedPickupTime] = useState(""),
    [editing, setEditing] = useState<Booking | null>(null),
    [cancel, setCancel] = useState<Booking | null>(null),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [filter, setFilter] = useState("");
  const loadId = useRef(0);
  const historyLoadId = useRef(0);
  const [history, setHistory] = useState<{
    bookings: Booking[];
    nextOffset: number | null;
  }>({ bookings: [], nextOffset: null });
  const [historyLoading, setHistoryLoading] = useState(false);
  const serverClock = useCancellationWindow(data.serverNow, data.bookings);
  async function loadHistory(offset = 0) {
    const id = ++historyLoadId.current;
    setHistoryLoading(true);
    try {
      const response = await fetch(`/api/booking-history?offset=${offset}`, {
        cache: "no-store",
      });
      if (response.status === 401 || response.status === 403) {
        window.location.assign("/login");
        return;
      }
      const next = await response.json();
      if (!response.ok) throw new UiError(next.error);
      if (id === historyLoadId.current)
        setHistory((old) => ({
          ...next,
          bookings: offset
            ? [...old.bookings, ...next.bookings]
            : next.bookings,
        }));
    } catch (e) {
      if (id === historyLoadId.current)
        setError(errorMessage(e, sv.errors.refresh));
    } finally {
      if (id === historyLoadId.current) setHistoryLoading(false);
    }
  }
  const onFocus = useEffectEvent(() => {
    void refresh();
  });
  useEffect(() => {
    const update = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  const formRef = useRef<HTMLFormElement>(null);
  const admin = data.actor.role === "admin";
  async function refresh(target = month) {
    const id = ++loadId.current;
    setLoading(true);
    try {
      const response = await fetch(`/api/calendar?month=${target}`, {
        cache: "no-store",
      });
      if (response.status === 401 || response.status === 403) {
        window.location.assign("/login");
        return;
      }
      const next = await response.json();
      if (!response.ok) throw new UiError(next.error);
      if (id === loadId.current) {
        setData(next);
        setMonth(target);
        if (tab === "history") await loadHistory();
      }
    } catch (e) {
      if (id === loadId.current) setError(errorMessage(e, sv.errors.refresh));
    } finally {
      if (id === loadId.current) setLoading(false);
    }
  }
  function clear() {
    setStart("");
    setEnd("");
    setEditing(null);
    setNote("");
    setArrivalTime("");
    setPickupTime("");
    setChoosingEnd(false);
  }
  function select(day: string) {
    setMessage("");
    setError("");
    if (!choosingEnd) {
      setStart(day);
      setEnd(day);
      setChoosingEnd(true);
    } else {
      if (day < start) {
        setEnd(start);
        setStart(day);
      } else setEnd(day);
      setChoosingEnd(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    const validation = validateRange(start, end, data.today);
    if (validation) {
      setError(validation);
      return;
    }
    if (!editing && action === "booking") {
      const timeError = bookingTimesError(
        start,
        end,
        arrivalTime || null,
        pickupTime || null,
      );
      if (timeError) {
        setError(timeError);
        return;
      }
    }
    setBusy(true);
    try {
      await api(
        editing
          ? `/api/bookings/${editing.id}`
          : action === "booking"
            ? "/api/bookings"
            : "/api/blocks",
        editing ? "PATCH" : action === "unblock" ? "DELETE" : "POST",
        {
          startDate: start,
          endDate: end,
          ownerId: ownerId || undefined,
          note,
          ...(!editing && action === "booking"
            ? {
                arrivalTime: arrivalTime || null,
                pickupTime: pickupTime || null,
              }
            : {}),
        },
      );
      setMessage(
        editing
          ? "Bokningen har uppdaterats."
          : action === "booking"
            ? admin
              ? "Bokningen är godkänd."
              : "Din bokningsförfrågan har skickats. Datumen är reserverade tills hundvakten har svarat."
            : action === "block"
              ? "Datumen har blockerats. Nu finns det tid för dina egna planer."
              : "Datumen är tillgängliga igen.",
      );
      clear();
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  async function cancelBooking() {
    if (!cancel) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/bookings/${cancel.id}`, "DELETE");
      setCancel(null);
      setMessage(
        "Bokningen har avbokats. Datumen är tillgängliga för hunden igen.",
      );
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    setBusy(true);
    try {
      await api("/api/auth/sign-out");
      window.location.assign("/login");
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }
  async function saveTimes(event: FormEvent) {
    event.preventDefault();
    if (!timeBooking) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(
        `/api/bookings/${timeBooking.id}/${proposalMode ? "time-proposals" : "times"}`,
        proposalMode ? "POST" : "PATCH",
        {
          ...(proposalMode ? { action: "propose" } : {}),
          ...((changedArrivalTime || null) !==
            (timeBooking.arrivalTime ?? null) ||
          (timeBooking.arrivalResubmissionRequired &&
            timeBooking.canEditArrival)
            ? { arrivalTime: changedArrivalTime || null }
            : {}),
          ...((changedPickupTime || null) !==
            (timeBooking.pickupTime ?? null) ||
          (timeBooking.pickupResubmissionRequired && timeBooking.canEditPickup)
            ? { pickupTime: changedPickupTime || null }
            : {}),
          expectedRevision: timeBooking.arrivalRevision ?? 0,
        },
      );
      setMessage(
        proposalMode
          ? "Tidsförslaget har skickats till hundägaren. Nuvarande tider gäller tills förslaget accepteras."
          : admin
            ? "Tiderna har sparats. Bokningens status är oförändrad."
            : "Din begäran om ändrade tider har skickats. Nuvarande tider gäller tills hundvakten godkänner ändringen.",
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setTimeBooking(null);
      await refresh();
      setBusy(false);
    }
  }
  function edit(b: Booking) {
    setEditing(b);
    setAction("booking");
    setStart(b.startDate);
    setEnd(b.endDate);
    setOwnerId(b.ownerId ?? "");
    setNote(b.note ?? "");
    setTab("calendar");
    setError("");
    setChoosingEnd(false);
    if (b.startDate.slice(0, 7) !== month)
      void refresh(b.startDate.slice(0, 7));
    setTimeout(
      () =>
        formRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        }),
      100,
    );
  }
  const active = data.bookings.filter(
    (b) => reservesDates(b.status) && b.endDate >= data.today,
  );
  const pending = data.bookings.filter(
    (b) => b.status === "pending" || b.timeProposal?.proposerRole === "owner",
  );
  const next = active[0];
  const selectedDays = start && end && end >= start ? dayCount(start, end) : 0;
  const bookings = (
    tab === "history" ? history.bookings : data.bookings
  ).filter(
    (b) =>
      (tab === "history" || showInUpcoming(b, serverClock)) &&
      (tab !== "requests" ||
        b.status === "pending" ||
        b.timeProposal?.proposerRole === "owner") &&
      (tab === "history" || !filter || b.ownerId === filter),
  );
  async function decide(b: Booking, decision: "confirmed" | "declined") {
    setBusy(true);
    setError("");
    try {
      await api(`/api/bookings/${b.id}/decision`, "POST", {
        decision,
        expectedRevision: b.arrivalRevision ?? 0,
      });
      setMessage(
        decision === "confirmed"
          ? "Bokningen är godkänd."
          : "Bokningsförfrågan har nekats. Datumen är tillgängliga för hunden igen.",
      );
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  async function answerTimeProposal(b: Booking, action: "approve" | "decline") {
    if (!b.timeProposal) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(`/api/bookings/${b.id}/time-proposals`, "POST", {
        action,
        proposalId: b.timeProposal.id,
        expectedRevision: b.arrivalRevision ?? 0,
      });
      setMessage(
        action === "approve"
          ? "Tidsförslaget har godkänts. De nya tiderna gäller nu."
          : "Tidsförslaget har avböjts. Nuvarande tider gäller fortfarande.",
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      await refresh();
      setBusy(false);
    }
  }
  function openTimes(b: Booking, propose = false) {
    setProposalMode(propose);
    setError("");
    setMessage("");
    setTimeBooking(b);
    setChangedArrivalTime(
      (propose ? b.timeProposal?.arrivalTime : undefined) ??
        b.arrivalTime ??
        "",
    );
    setChangedPickupTime(
      (propose ? b.timeProposal?.pickupTime : undefined) ?? b.pickupTime ?? "",
    );
  }
  async function retryNotifications() {
    setBusy(true);
    setError("");
    try {
      const result = await api("/api/notifications");
      setMessage(
        result.configured
          ? "Väntande mejl har kontrollerats. Eventuella leveransproblem sparas för nya försök."
          : "E-postaviseringar är ännu inte aktiverade. Bokningarna är sparade i kalendern.",
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const bookingList = (
    <section
      className="bookings-section"
      aria-busy={tab === "history" && historyLoading}
    >
      <div className="section-heading compact">
        <div>
          <p className="eyebrow">I KALENDERN</p>
          <h2>
            {tab === "history"
              ? "Bokningshistorik"
              : tab === "requests"
                ? "Bokningsförfrågningar"
                : admin
                  ? "Vistelser"
                  : "Dina kommande vistelser"}
          </h2>
        </div>
        {admin && tab !== "history" && (
          <label className="filter-label">
            <span className="sr-only">Filtrera efter hundägare</span>
            <select
              aria-label="Filtrera efter hundägare"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="">Alla hundägare</option>
              {data.owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} · {o.dogName}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {tab === "history" && historyLoading && bookings.length === 0 ? (
        <p role="status">Hämtar bokningshistoriken…</p>
      ) : bookings.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">
            <CalendarDays size={24} />
          </span>
          <h3>
            {tab === "history"
              ? "Ingen bokningshistorik ännu."
              : tab === "requests"
                ? "Inga förfrågningar väntar på svar."
                : "Här finns plats för nya planer."}
          </h3>
          <p>
            {tab === "history"
              ? "Avbokade, nekade och avslutade vistelser sparas här."
              : admin
                ? "Bokningarna visas här när en hundägare har bokat."
                : "Välj datum i kalendern för att boka nästa vistelse."}
          </p>
          {tab === "bookings" && (
            <button className="text-button" onClick={() => setTab("calendar")}>
              Visa kalendern <ArrowRight size={16} />
            </button>
          )}
        </div>
      ) : (
        <div className="booking-list">
          {bookings.map((b) => (
            <article
              className={`booking-row ${!reservesDates(b.status) ? "is-cancelled" : ""}`}
              data-booking-id={b.id}
              key={b.id}
            >
              <div className="booking-date">
                <span>{formatDate(b.startDate, { month: "short" })}</span>
                <strong>{Number(b.startDate.slice(8))}</strong>
              </div>
              <div className="booking-info">
                <h3>
                  Vistelse för {b.dogName ?? "hunden"}{" "}
                  <span
                    className={`badge ${!reservesDates(b.status) ? "cancelled" : ""}`}
                  >
                    {bookingStatusLabel[b.status]}
                  </span>
                </h3>
                <p>
                  {formatRange(b.startDate, b.endDate)}
                  <span className="dot-separator">·</span>
                  {dayCount(b.startDate, b.endDate)}{" "}
                  {dayCount(b.startDate, b.endDate) === 1 ? "dag" : "dagar"}
                  {admin && b.ownerName && (
                    <>
                      <span className="dot-separator">·</span>
                      {b.ownerName}
                    </>
                  )}
                </p>
                <p className="arrival-details">
                  Lämning: {formatDate(b.startDate)} ·{" "}
                  {arrivalTimeLabel(b.arrivalTime)}
                </p>
                <p className="pickup-details">
                  Hämtning: {formatDate(b.endDate)} ·{" "}
                  {arrivalTimeLabel(b.pickupTime)}
                </p>
                {!b.timeProposal &&
                  (b.arrivalResubmissionRequired ||
                    b.pickupResubmissionRequired) && (
                    <p className="field-hint">
                      Ett nytt förslag behövs för{" "}
                      {b.arrivalResubmissionRequired &&
                      b.pickupResubmissionRequired
                        ? "lämning och hämtning"
                        : b.arrivalResubmissionRequired
                          ? "lämning"
                          : "hämtning"}
                      . Du kan även skicka nuvarande tid för godkännande igen.
                    </p>
                  )}
                {b.timeProposal && (
                  <div className="time-proposal">
                    <strong>
                      {b.timeProposal.proposerRole === "owner"
                        ? "Önskemål om ändrade tider"
                        : "Hundvaktens tidsförslag"}
                    </strong>
                    <p>
                      Föreslagen lämning:{" "}
                      {arrivalTimeLabel(b.timeProposal.arrivalTime)} ·
                      Föreslagen hämtning:{" "}
                      {arrivalTimeLabel(b.timeProposal.pickupTime)}
                    </p>
                    <p className="field-hint">
                      Nuvarande tider ovan gäller tills förslaget godkänns.
                      Bokningens status är oförändrad.
                    </p>
                    {(admin && b.timeProposal.proposerRole === "owner") ||
                    (!admin && b.timeProposal.proposerRole === "admin") ? (
                      <div className="booking-actions">
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => void answerTimeProposal(b, "approve")}
                        >
                          {admin ? "Godkänn tidsändring" : "Acceptera tider"}
                        </button>
                        <button
                          className="text-button danger-text"
                          disabled={busy}
                          onClick={() => void answerTimeProposal(b, "decline")}
                        >
                          {admin ? "Neka tidsändring" : "Tacka nej till tider"}
                        </button>
                      </div>
                    ) : (
                      <p className="field-hint">
                        {admin
                          ? "Väntar på hundägarens svar."
                          : "Väntar på hundvaktens svar."}
                      </p>
                    )}
                  </div>
                )}
                {!admin && reservesDates(b.status) && !b.canEditArrival && (
                  <p className="field-hint">
                    Lämningsdagen har passerat. Kontakta hundvakten om
                    lämningstiden behöver ändras.
                  </p>
                )}
                {admin && b.note && (
                  <p className="private-note">
                    <ShieldCheck size={12} />
                    {b.note}
                  </p>
                )}
              </div>
              {reservesDates(b.status) && (
                <div className="booking-actions">
                  {(b.canEditArrival || b.canEditPickup) &&
                    (admin || !b.timeProposal) && (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => openTimes(b)}
                      >
                        {admin ? "Ändra tider" : "Begär tidsändring"}
                      </button>
                    )}
                  {admin && (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => openTimes(b, true)}
                    >
                      Föreslå tider
                    </button>
                  )}
                  {admin && b.status === "pending" && (
                    <>
                      <button
                        className="text-button"
                        disabled={busy || !!b.timeProposal}
                        onClick={() => decide(b, "confirmed")}
                      >
                        Godkänn
                      </button>
                      <button
                        className="text-button danger-text"
                        disabled={busy}
                        onClick={() => decide(b, "declined")}
                      >
                        Neka
                      </button>
                    </>
                  )}
                  {admin && (
                    <button className="text-button" onClick={() => edit(b)}>
                      Ändra
                    </button>
                  )}
                  {((admin && b.status === "confirmed") ||
                    (!admin && b.startDate > data.today)) && (
                    <button
                      className="text-button danger-text"
                      onClick={() => {
                        setError("");
                        setCancel(b);
                      }}
                    >
                      {sv.cancelBooking}
                    </button>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {tab === "history" && history.nextOffset !== null && (
        <button
          className="text-button"
          disabled={historyLoading}
          onClick={() => void loadHistory(history.nextOffset!)}
        >
          Visa fler vistelser <ArrowRight size={16} />
        </button>
      )}
    </section>
  );
  return (
    <div className="app-shell" inert={!hydrated}>
      <aside className="sidebar">
        <Brand />
        <div className="workspace-label">
          {admin ? "FÖR DIG SOM HUNDVAKT" : "DIN TRYGGA PLATS"}
        </div>
        <nav aria-label="Huvudnavigation">
          {admin && (
            <button
              className={tab === "requests" ? "active" : ""}
              onClick={() => {
                setFilter("");
                setTab("requests");
              }}
            >
              <Clock size={19} />
              <span className="nav-label">Bokningsförfrågningar</span>
              <span className="nav-count">{pending.length}</span>
            </button>
          )}
          <button
            className={tab === "calendar" ? "active" : ""}
            onClick={() => setTab("calendar")}
          >
            <CalendarDays size={19} />
            Kalender{tab === "calendar" && <ChevronRight size={16} />}
          </button>
          <button
            className={tab === "bookings" ? "active" : ""}
            onClick={() => setTab("bookings")}
          >
            <CalendarCheck size={19} />
            {admin ? "Alla bokningar" : "Mina bokningar"}
            <span className="nav-count">{active.length}</span>
          </button>
          <button
            className={tab === "history" ? "active" : ""}
            onClick={() => {
              setTab("history");
              setError("");
              void loadHistory();
            }}
          >
            <History size={19} /> Bokningshistorik
          </button>
          {admin && (
            <button
              className={tab === "windows" ? "active" : ""}
              onClick={() => setTab("windows")}
            >
              <Clock size={19} />
              Tidsfönster
            </button>
          )}
          {admin && (
            <button
              className={tab === "owners" ? "active" : ""}
              onClick={() => setTab("owners")}
            >
              <PawPrint size={19} />
              Hundar och ägare
            </button>
          )}
        </nav>
        <div className="sidebar-note">
          <Leaf size={24} />
          <p>
            Mer tid för
            <br />
            det som gör dig glad.
          </p>
          <span>
            En privat plats för
            <br />
            din lilla krets.
          </span>
        </div>
        <div className="profile">
          <span className="avatar">
            {data.actor.name
              .split(" ")
              .map((n) => n[0])
              .slice(0, 2)
              .join("")}
          </span>
          <div>
            <strong>{data.actor.name.split(" ")[0]}</strong>
            <small>
              {admin
                ? "Administratör"
                : `Hundägare till ${data.actor.dogName ?? "hunden"}`}
            </small>
          </div>
          <button
            className="icon-button"
            aria-label={sv.signOut}
            disabled={busy}
            onClick={signOut}
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <span>
            <span className="status-dot" />
            {admin
              ? "Din privata kalender för hundpassning"
              : "En trygg plats för din bästa vän"}
          </span>
          <span className="topbar-date">
            {formatDate(data.today, {
              weekday: "short",
              day: "numeric",
              month: "long",
            })}
          </span>
        </header>
        <div className="content-wrap">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {admin
                  ? "LITE PLANERING GÖR STOR SKILLNAD"
                  : "VAD ROLIGT ATT SE DIG IGEN"}
              </p>
              <h1>
                {tab === "windows"
                  ? "Tider som passar dig."
                  : tab === "history"
                    ? "Dina tidigare vistelser."
                    : tab === "owners"
                      ? "Din lilla krets."
                      : tab === "requests"
                        ? "Bokningsförfrågningar"
                        : tab === "bookings"
                          ? "Alla härliga vistelser på ett ställe."
                          : admin
                            ? "Dags att planera något fint."
                            : `Planera nästa vistelse för ${data.actor.dogName ?? "din hund"}.`}
              </h1>
              <p>
                {admin
                  ? "Håll koll på lediga datum och kommande besök."
                  : "Välj dina datum. Vi tar hand om resten."}
              </p>
            </div>
            <span className="private-badge">
              <ShieldCheck size={14} />
              Endast för inbjudna
            </span>
          </div>
          {message && (
            <div className="alert success" role="status">
              <Check size={18} />
              {message}
              <button
                className="icon-button"
                aria-label="Stäng meddelandet"
                onClick={() => setMessage("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {error && !cancel && (
            <div className="alert error" role="alert">
              {error}
              <button
                className="icon-button"
                aria-label="Stäng felmeddelandet"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {tab === "windows" && admin && (
            <TimeWindowSettings
              key={data.timeWindows.revision}
              settings={data.timeWindows}
              onSaved={async () => {
                await refresh();
                setMessage(
                  "Tidsfönstren har sparats. Befintliga bokningar behåller sina tider.",
                );
              }}
            />
          )}
          {tab === "windows" ? null : tab === "owners" ? (
            <Owners
              owners={data.owners}
              limit={data.ownerLimit}
              onRefresh={() => refresh()}
            />
          ) : tab === "bookings" || tab === "requests" || tab === "history" ? (
            <>
              {bookingList}
              {tab === "requests" && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={retryNotifications}
                >
                  Försök skicka väntande mejl
                </button>
              )}
            </>
          ) : (
            <>
              <div className="overview-strip">
                <div>
                  <span className="overview-icon">
                    <PawPrint size={19} />
                  </span>
                  <div>
                    <small>{admin ? "I DIN KRETS" : "DIN HUND"}</small>
                    <strong>
                      {admin
                        ? `${data.owners.length} ${data.owners.length === 1 ? "hund" : "hundar"}`
                        : data.actor.dogName}
                    </strong>
                  </div>
                </div>
                <div>
                  <span className="overview-icon">
                    <CalendarCheck size={19} />
                  </span>
                  <div>
                    <small>KOMMANDE VISTELSER</small>
                    <strong>
                      {active.length}{" "}
                      {active.length === 1 ? "bokning" : "bokningar"}
                    </strong>
                  </div>
                </div>
                <div>
                  <span className="overview-icon">
                    <Clock size={19} />
                  </span>
                  <div>
                    <small>NÄSTA BESÖK</small>
                    <strong>
                      {next
                        ? formatDate(next.startDate, {
                            day: "numeric",
                            month: "short",
                          })
                        : "Ingen bokning ännu"}
                    </strong>
                  </div>
                  {next && <ArrowUpRight className="next-arrow" size={18} />}
                </div>
              </div>
              <div className="calendar-layout">
                <MonthCalendar
                  month={month}
                  today={data.today}
                  entries={data.entries}
                  start={start}
                  end={end}
                  admin={admin}
                  ownerId={ownerId}
                  action={action}
                  editingId={editing?.id}
                  onMonth={(target) => void refresh(target)}
                  onSelect={select}
                  loading={loading}
                />
                <aside className="booking-panel">
                  <div className="panel-heading">
                    <span className="section-icon">
                      <CalendarDays size={21} />
                    </span>
                    <h2>
                      {editing
                        ? "Ändra vistelsen"
                        : admin
                          ? "Planera i kalendern"
                          : "Boka en vistelse"}
                    </h2>
                    <p>
                      {editing
                        ? "Ändra datum eller uppgifter nedan."
                        : "Välj en dag eller tryck på ett start- och slutdatum."}
                    </p>
                  </div>
                  {admin && !editing && (
                    <div className="segmented" aria-label="Åtgärd i kalendern">
                      {(["booking", "block", "unblock"] as const).map((a) => (
                        <button
                          key={a}
                          className={action === a ? "active" : ""}
                          onClick={() => {
                            setAction(a);
                            setError("");
                          }}
                        >
                          {a === "booking"
                            ? sv.book
                            : a === "block"
                              ? "Blockera"
                              : "Frigör"}
                        </button>
                      ))}
                    </div>
                  )}
                  <form
                    onInvalid={localizeValidation}
                    onInput={clearValidation}
                    ref={formRef}
                    className="booking-form"
                    onSubmit={submit}
                  >
                    <div className="date-inputs">
                      <label>
                        {sv.from}
                        <input
                          type="date"
                          disabled={!hydrated}
                          required
                          min={data.today}
                          value={start}
                          onChange={(e) => {
                            setStart(e.target.value);
                            if (!end || end < e.target.value)
                              setEnd(e.target.value);
                            setChoosingEnd(false);
                          }}
                        />
                      </label>
                      <label>
                        {sv.through}
                        <input
                          type="date"
                          disabled={!hydrated}
                          required
                          min={start || data.today}
                          value={end}
                          onChange={(e) => {
                            setEnd(e.target.value);
                            setChoosingEnd(false);
                          }}
                        />
                      </label>
                    </div>
                    {admin && action === "booking" && (
                      <label>
                        Hund
                        <select
                          aria-label="Hund"
                          required
                          value={ownerId}
                          onChange={(e) => setOwnerId(e.target.value)}
                        >
                          <option value="">Välj en hund</option>
                          {data.owners
                            .filter((o) => o.isActive)
                            .map((o) => (
                              <option value={o.id} key={o.id}>
                                {o.dogName} · {o.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    )}
                    {action === "booking" && !editing && (
                      <>
                        <BookingTimeSelect
                          label="Lämningstid"
                          required
                          window={
                            admin
                              ? undefined
                              : applicableWindow(
                                  data.timeWindows,
                                  start,
                                  "arrival",
                                )
                          }
                          value={arrivalTime}
                          onChange={setArrivalTime}
                          disabled={!hydrated || busy}
                        />
                        <BookingTimeSelect
                          label="Hämtningstid"
                          required
                          window={
                            admin
                              ? undefined
                              : applicableWindow(
                                  data.timeWindows,
                                  end,
                                  "pickup",
                                )
                          }
                          value={pickupTime}
                          onChange={setPickupTime}
                          disabled={!hydrated || busy}
                        />
                      </>
                    )}
                    {admin && action !== "unblock" && (
                      <label>
                        {sv.privateNote}{" "}
                        <span className="optional">valfritt</span>
                        <textarea
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          maxLength={1000}
                          placeholder={
                            action === "block"
                              ? "En resa, en ledig dag…"
                              : "Bara för dig. Hundägarna ser inte detta."
                          }
                          rows={2}
                        />
                      </label>
                    )}
                    <div className="selection-summary" aria-live="polite">
                      {selectedDays ? (
                        <>
                          <strong>
                            {selectedDays}{" "}
                            {selectedDays === 1 ? "dag" : "dagar"}{" "}
                            {action === "booking"
                              ? "med gott sällskap"
                              : action === "block"
                                ? "för dina egna planer"
                                : "att göra tillgängliga"}
                          </strong>
                          <span>{formatRange(start, end)}</span>
                          {action === "booking" &&
                            sharedStays(data.entries, start, end).map(
                              (stay, i) => (
                                <span
                                  className="shared-stay"
                                  key={`${stay.dogName}-${stay.startDate}-${i}`}
                                >
                                  {comingLabel([stay.dogName])} ·{" "}
                                  {formatRange(stay.startDate, stay.endDate)}
                                </span>
                              ),
                            )}
                        </>
                      ) : (
                        <>
                          <PawPrint size={21} />
                          <span>Dina valda datum visas här</span>
                        </>
                      )}
                    </div>
                    <button
                      className="button primary full"
                      disabled={busy || loading || !selectedDays}
                    >
                      {busy
                        ? sv.saving
                        : editing
                          ? sv.saveChanges
                          : action === "booking"
                            ? admin
                              ? "Godkänn bokning"
                              : "Skicka bokningsförfrågan"
                            : action === "block"
                              ? sv.blockDates
                              : "Gör datumen tillgängliga"}
                      <ArrowRight size={17} />
                    </button>
                    {(start || editing) && (
                      <button
                        type="button"
                        className="text-button clear-button"
                        disabled={busy}
                        onClick={clear}
                      >
                        {editing ? "Ångra ändringar" : "Rensa val"}
                      </button>
                    )}
                    <p className="booking-reassurance">
                      {action === "booking" ? (
                        <>
                          <ShieldCheck size={14} />
                          {admin
                            ? "Bokningen godkänns direkt. Olika hundar kan komma samtidigt."
                            : "Hundvakten behöver godkänna bokningen. Datumen reserveras för din hund medan du väntar. Den andra hunden kan komma samtidigt."}
                        </>
                      ) : action === "block" ? (
                        <>Blockerade datum kan inte bokas av hundägarna.</>
                      ) : (
                        <>
                          Bara blockerade datum frigörs. Bokningarna finns kvar.
                        </>
                      )}
                    </p>
                  </form>
                  <div className="panel-footnote">
                    <Leaf size={18} />
                    <span>
                      {admin ? "Din kalender, i din takt." : "Ett andra hem."}
                    </span>
                  </div>
                </aside>
              </div>
              {bookingList}
              {admin && (
                <p className="info-note">
                  Välj en tidigare månad i kalendern för att se och ändra tider
                  för tidigare vistelser.
                </p>
              )}
            </>
          )}
          <footer className="app-footer">
            <span>För en liten krets av riktigt härliga hundar.</span>
            <span>Svensk tid</span>
          </footer>
        </div>
      </main>
      {timeBooking && (
        <Modal
          title={
            proposalMode
              ? "Föreslå tider"
              : admin
                ? "Ändra tider"
                : "Begär tidsändring"
          }
          onClose={() => !busy && setTimeBooking(null)}
        >
          <form
            className="booking-form"
            onSubmit={saveTimes}
            onInvalid={localizeValidation}
            onInput={clearValidation}
          >
            <p>
              Vistelse för {timeBooking.dogName ?? "hunden"}:{" "}
              {formatRange(timeBooking.startDate, timeBooking.endDate)}.
            </p>
            <BookingTimeSelect
              label="Lämningstid"
              window={
                admin
                  ? undefined
                  : applicableWindow(
                      data.timeWindows,
                      timeBooking.startDate,
                      "arrival",
                    )
              }
              value={changedArrivalTime}
              onChange={setChangedArrivalTime}
              disabled={busy || !timeBooking.canEditArrival}
            />
            {!admin && (
              <p className="field-hint">
                {timeBooking.canEditArrival
                  ? `Lämningstiden kan ändras till kl. 23:59:59 den ${formatDate(timeBooking.startDate)}, svensk tid.`
                  : "Lämningsdagen har passerat. Bara hundvakten kan ändra lämningstiden."}
              </p>
            )}
            <BookingTimeSelect
              label="Hämtningstid"
              window={
                admin
                  ? undefined
                  : applicableWindow(
                      data.timeWindows,
                      timeBooking.endDate,
                      "pickup",
                    )
              }
              value={changedPickupTime}
              onChange={setChangedPickupTime}
              disabled={busy || !timeBooking.canEditPickup}
            />
            {!admin && (
              <p className="field-hint">
                {timeBooking.canEditPickup
                  ? `Hämtningstiden kan ändras till kl. 23:59:59 den ${formatDate(timeBooking.endDate)}, svensk tid.`
                  : "Hämtningsdagen har passerat. Bara hundvakten kan ändra hämtningstiden."}
              </p>
            )}
            <p className="field-hint">
              {admin && !proposalMode
                ? "Du ändrar tiderna direkt. Ett eventuellt öppet tidsförslag avslutas. Bokningens status och datum är oförändrade."
                : "Nuvarande tider gäller tills förslaget godkänns. Bokningens status och datum är oförändrade."}
            </p>
            <button
              className="button primary full"
              disabled={
                busy ||
                (!(
                  timeBooking.arrivalResubmissionRequired &&
                  timeBooking.canEditArrival
                ) &&
                  !(
                    timeBooking.pickupResubmissionRequired &&
                    timeBooking.canEditPickup
                  ) &&
                  (changedArrivalTime || null) ===
                    (timeBooking.arrivalTime ?? null) &&
                  (changedPickupTime || null) ===
                    (timeBooking.pickupTime ?? null))
              }
            >
              {busy
                ? sv.saving
                : proposalMode
                  ? "Skicka tidsförslag"
                  : admin
                    ? "Spara tider"
                    : "Skicka ändringsförfrågan"}
            </button>
          </form>
        </Modal>
      )}
      {cancel && (
        <Modal
          title="Vill du avboka vistelsen?"
          onClose={() => !busy && setCancel(null)}
        >
          <p className="muted">
            Vistelsen för {cancel.dogName ?? "hunden"} den{" "}
            {formatRange(cancel.startDate, cancel.endDate)} avbokas. Datumen
            blir tillgängliga för hunden igen.
          </p>
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          <div className="modal-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setCancel(null)}
            >
              Behåll bokningen
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={cancelBooking}
            >
              {busy ? "Avbokar…" : sv.cancelBooking}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
