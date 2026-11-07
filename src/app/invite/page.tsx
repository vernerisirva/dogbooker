import { Brand } from "@/components/brand";
import { AuthForm } from "@/components/auth-form";
export default function Invite() {
  return (
    <main className="invite-page">
      <Brand />
      <div className="invite-card">
        <p className="eyebrow">DU ÄR INBJUDEN</p>
        <h1>
          Känn dig
          <br />
          som hemma.
        </h1>
        <p className="muted">
          Välj ett lösenord till ditt privata DogBooker-konto.
        </p>
        <AuthForm invite />
      </div>
      <p className="auth-bottom">
        Nästa härliga vistelse är bara några klick bort.
      </p>
    </main>
  );
}
