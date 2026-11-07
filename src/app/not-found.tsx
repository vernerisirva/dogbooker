import Link from "next/link";
export default function NotFound() {
  return (
    <main className="page-loading">
      <h1>Sidan kunde inte hittas.</h1>
      <Link href="/" className="button primary">
        Tillbaka till kalendern
      </Link>
    </main>
  );
}
