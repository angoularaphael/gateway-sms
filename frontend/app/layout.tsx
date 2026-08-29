import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SMS Gateway",
  description: "Passerelle SMS sur téléphones Android",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
