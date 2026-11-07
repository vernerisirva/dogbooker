"use client";
import {
  UiError,
  errorMessage,
  localizeValidation,
  clearValidation,
} from "@/lib/ui";
import { sv } from "@/lib/swedish";
import { useState, FormEvent } from "react";
import { Copy, Plus, Mail, PawPrint, Pencil, Check } from "lucide-react";
import { Modal } from "./modal";
export type Owner = {
  id: string;
  name: string;
  email: string;
  dogName: string;
  isActive: boolean;
  hasPassword: boolean;
};
export async function api(path: string, method = "POST", body: unknown = {}) {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (response.status === 401) {
    window.location.assign("/login");
    throw new UiError(sv.errors.signInAgain);
  }
  if (!response.ok)
    throw new UiError(
      path.startsWith("/api/auth/")
        ? sv.errors.save
        : (data.error ?? sv.errors.save),
    );
  return data;
}
export function Owners({
  owners,
  limit,
  onRefresh,
}: {
  owners: Owner[];
  limit: number;
  onRefresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<Owner | "new" | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [invite, setInvite] = useState(""),
    [copied, setCopied] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const body = {
      name: form.get("name"),
      email: form.get("email"),
      dogName: form.get("dogName"),
      isActive: form.get("isActive") === "on",
    };
    try {
      const result = await api(
        editing === "new"
          ? "/api/owners"
          : `/api/owners/${(editing as Owner).id}`,
        editing === "new" ? "POST" : "PATCH",
        body,
      );
      setEditing(null);
      if (result.url) setInvite(result.url);
      await onRefresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function reissue(owner: Owner) {
    setBusy(true);
    setError("");
    try {
      const result = await api(`/api/owners/${owner.id}`);
      setInvite(result.url);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="owners-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">VÅR LILLA KRETS</p>
          <h2>Hundar och deras ägare</h2>
          <p className="muted">Hundar och hundägare. En trygg plats.</p>
        </div>
        <button
          className="button primary"
          disabled={busy || (limit > 0 && owners.length >= limit)}
          onClick={() => {
            setError("");
            setEditing("new");
          }}
        >
          <Plus size={17} />
          Bjud in hundägare
        </button>
      </div>
      {error && !editing && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <div className="owner-grid">
        {owners.map((o) => (
          <article className="owner-card" key={o.id}>
            <div className="owner-card-top">
              <span className="dog-avatar">
                <PawPrint size={25} />
              </span>
              <span className={`badge ${o.isActive ? "" : "cancelled"}`}>
                {!o.isActive ? "Pausad" : o.hasPassword ? "Aktiv" : "Inbjuden"}
              </span>
            </div>
            <h3>{o.dogName}</h3>
            <p>{o.name}</p>
            <p className="owner-email">{o.email}</p>
            <div className="owner-actions">
              <button
                className="button secondary"
                onClick={() => {
                  setError("");
                  setEditing(o);
                }}
              >
                <Pencil size={15} />
                Ändra uppgifter
              </button>
              <button
                className="text-button"
                disabled={!o.isActive || busy}
                onClick={() => reissue(o)}
              >
                <Mail size={16} />
                Ny aktiveringslänk
              </button>
            </div>
          </article>
        ))}
        {owners.length === 0 && (
          <div className="owner-empty">
            <PawPrint size={32} />
            <h3>Välkomna din första hundägare.</h3>
            <p>
              Bjud in varje hundägare via e-postadressen.
              <br />
              De väljer sedan sitt eget lösenord.
            </p>
          </div>
        )}
      </div>
      <aside className="info-note">
        Aktiveringslänkar gäller i 48 timmar. Dela dem direkt med rätt
        hundägare. Om du pausar ett konto loggas hundägaren ut, men bokningarna
        finns kvar i kalendern.
      </aside>
      {editing && (
        <Modal
          title={
            editing === "new" ? "Bjud in en hundägare" : "Hundägarens uppgifter"
          }
          onClose={() => !busy && setEditing(null)}
        >
          <form
            className="stack-form"
            onSubmit={save}
            onInvalid={localizeValidation}
            onInput={clearValidation}
          >
            <label>
              Hundägarens namn
              <input
                name="name"
                required
                maxLength={80}
                defaultValue={editing === "new" ? "" : editing.name}
              />
            </label>
            <label>
              {sv.email}
              <input
                type="email"
                name="email"
                required
                maxLength={254}
                defaultValue={editing === "new" ? "" : editing.email}
              />
            </label>
            <label>
              Hundens namn
              <input
                name="dogName"
                required
                maxLength={80}
                placeholder="Hundens namn"
                defaultValue={editing === "new" ? "" : editing.dogName}
              />
            </label>
            {editing !== "new" && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  name="isActive"
                  defaultChecked={editing.isActive}
                />
                Kontot är aktivt
              </label>
            )}
            {error && (
              <div className="alert error" role="alert">
                {error}
              </div>
            )}
            <p className="field-hint">
              {editing === "new"
                ? "Du får en privat länk att dela med hundägaren."
                : "Om du ändrar e-postadressen måste hundägaren välja ett nytt lösenord."}
            </p>
            <button className="button primary full" disabled={busy}>
              {busy
                ? sv.saving
                : editing === "new"
                  ? "Skapa inbjudan"
                  : "Spara uppgifter"}
            </button>
          </form>
        </Modal>
      )}
      {invite && (
        <Modal
          title="Inbjudan är klar"
          onClose={() => {
            setInvite("");
            setCopied(false);
          }}
        >
          <p className="muted">
            Dela länken privat med hundägaren. Den kan också användas för att
            återställa lösenordet.
          </p>
          <label className="invite-link-label">
            Privat aktiveringslänk
            <input readOnly value={invite} onFocus={(e) => e.target.select()} />
          </label>
          <button
            className="button primary full"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(invite);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? <Check size={17} /> : <Copy size={17} />}{" "}
            {copied ? "Kopierad" : "Kopiera inbjudan"}
          </button>
          <p className="field-hint">
            Gäller i 48 timmar. Bara den senaste länken fungerar.
          </p>
        </Modal>
      )}
    </section>
  );
}
