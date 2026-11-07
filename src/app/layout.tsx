import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "DogBooker · Ett andra hem för din hund",
  description: "Din privata kalender för hundpassning.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="sv">
      <body>{children}</body>
    </html>
  );
}
