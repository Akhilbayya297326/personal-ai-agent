import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Daymark — a chat that remembers",
  description: "A careful web-search agent with timestamped memory for the things you ask.",
  icons: { icon: "/daymark-icon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
