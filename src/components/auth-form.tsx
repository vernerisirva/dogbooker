"use client";
import {
  UiError,
  errorMessage,
  localizeValidation,
  clearValidation,
} from "@/lib/ui";
import { sv } from "@/lib/swedish";
import { FormEvent, useEffect, useState, useRef } from "react";
import { ArrowRight, Check, LockKeyhole, Eye, EyeOff } from "lucide-react";
import { useHydrated } from "./use-hydrated";
export function AuthForm({ invite = false }: { invite?: boolean }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState(false),
    [token, setToken] = useState(""),
    [show, setShow] = useState(false);
  const hydrated = useHydrated();
  const captured = useRef(false);
  useEffect(() => {
    if (invite && !captured.current) {
      captured.current = true;
      // The invitation lives in the browser-only URL fragment, never a server prop.
      setToken(window.location.hash.slice(1));
      window.history.replaceState(window.history.state, "", "/invite");
    }
  }, [invite]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(
        invite ? "/api/invitations/accept" : "/api/auth/sign-in/email",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            invite
              ? { token, password: form.get("password") }
              : { email: form.get("email"), password: form.get("password") },
          ),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new UiError(
          invite
            ? (data.error ?? sv.errors.invitation)
            : response.status === 429
              ? sv.errors.rateLimit
              : sv.errors.signIn,
        );
      if (invite) setDone(true);
      else window.location.assign("/");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  if (done)
    return (
      <div className="auth-success">
        <span className="success-circle">
          <Check />
        </span>
        <h2>Allt är klart.</h2>
        <p>Ditt lösenord är sparat. Logga in för att se kalendern.</p>
        <a className="button primary full" href="/login">
          Till inloggningen <ArrowRight size={18} />
        </a>
      </div>
    );
  return (
    <form
      onInvalid={localizeValidation}
      onInput={clearValidation}
      onSubmit={submit}
      method="post"
      className="auth-form"
      data-ready={hydrated}
      inert={!hydrated}
    >
      {!invite && (
        <label>
          {sv.email}
          <input
            disabled={!hydrated}
            name="email"
            type="email"
            autoComplete="username"
            placeholder="du@example.test"
            required
            maxLength={254}
          />
        </label>
      )}
      <label>
        {invite ? "Välj ett lösenord" : sv.password}
        <span className="password-field">
          <input
            disabled={!hydrated}
            name="password"
            type={show ? "text" : "password"}
            autoComplete={invite ? "new-password" : "current-password"}
            minLength={invite ? 12 : undefined}
            maxLength={128}
            required
            placeholder={invite ? "Minst 12 tecken" : "Ange ditt lösenord"}
          />
          <button
            type="button"
            className="icon-button"
            aria-label={show ? "Dölj lösenord" : "Visa lösenord"}
            onClick={() => setShow(!show)}
          >
            {show ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </span>
      </label>
      {invite && (
        <p className="field-hint">
          Använd minst 12 tecken. Använd gärna några ord som är lätta att komma
          ihåg.
        </p>
      )}
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <button
        className="button primary full"
        disabled={!hydrated || busy || (invite && !token)}
      >
        {busy ? "Ett ögonblick…" : invite ? "Spara lösenord" : sv.signIn}
        <ArrowRight size={18} />
      </button>
      <p className="auth-help">
        <LockKeyhole size={14} />
        {invite
          ? "Inbjudan är privat och kan bara användas en gång."
          : "Endast för inbjudna. Behöver du hjälp att logga in? Kontakta din hundvakt."}
      </p>
      {invite && !token && (
        <p className="alert error">
          Öppna hela inbjudningslänken som din hundvakt har delat. Om du har
          laddat om sidan behöver du öppna länken igen.
        </p>
      )}
    </form>
  );
}
