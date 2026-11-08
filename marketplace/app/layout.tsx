import type { Metadata } from "next";
import "./style.css";
export const metadata: Metadata = {
  title: "DogBooker · Hitta din hundvakt",
  description: "En lokal demonstration av personlig hundpassning.",
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv">
      <body>{children}</body>
    </html>
  );
}
