import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Maintiva",
  description: "Predictive maintenance, customer retention, and shop management for modern repair shops"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
