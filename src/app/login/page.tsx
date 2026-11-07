import { Brand } from "@/components/brand";
import { AuthForm } from "@/components/auth-form";
import { Heart, CalendarDays, ShieldCheck, PawPrint } from "lucide-react";
export default function Login() {
  return (
    <main className="auth-page">
      <section className="auth-story">
        <Brand />
        <div className="story-center">
          <div className="dog-illustration" aria-hidden="true">
            <span className="orbit orbit-one" />
            <span className="orbit orbit-two" />
            <div className="dog-face">
              <span className="ear left" />
              <span className="ear right" />
              <span className="eye left" />
              <span className="eye right" />
              <span className="muzzle">
                <i />
              </span>
            </div>
            <span className="floating-heart">
              <Heart size={28} fill="currentColor" />
            </span>
            <span className="floating-paw">
              <PawPrint size={26} />
            </span>
          </div>
          <p className="eyebrow">ETT ANDRA HEM FÖR DIN HUND</p>
          <h1>
            Gott sällskap.
            <br />
            Glada tassar.
          </h1>
          <p className="story-copy">
            En trygg plats för din hund.
            <br />
            Lite mer lugn i vardagen för dig.
          </p>
        </div>
        <div className="story-footer">
          <span>
            <CalendarDays size={16} /> Enkel planering
          </span>
          <span>
            <Heart size={16} /> Personlig omsorg
          </span>
        </div>
      </section>
      <section className="auth-panel">
        <div className="mobile-brand">
          <Brand />
        </div>
        <div className="auth-box">
          <span className="section-icon">
            <ShieldCheck size={22} />
          </span>
          <p className="eyebrow">DIN PRIVATA KALENDER</p>
          <h2>Välkommen tillbaka.</h2>
          <p className="muted">Här börjar nästa härliga vistelse.</p>
          <AuthForm />
        </div>
        <p className="auth-bottom">En liten krets. Mycket omtanke.</p>
      </section>
    </main>
  );
}
