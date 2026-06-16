"use client";

import { Printer } from "lucide-react";

export function PrintQuoteButton() {
  return <button className="button secondary" type="button" onClick={() => window.print()}><Printer /> Print PDF</button>;
}
