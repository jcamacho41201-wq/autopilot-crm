import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AutoPilot CRM",
  description: "Predictive maintenance CRM for independent auto repair shops"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
