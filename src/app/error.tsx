"use client";
import { sv } from "@/lib/swedish";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="page-loading">
      <h1>Vi försöker igen.</h1>
      <p>Kalendern kunde inte laddas. Dina bokningar finns kvar.</p>
      <button className="button primary" onClick={reset}>
        {sv.retry}
      </button>
    </main>
  );
}
