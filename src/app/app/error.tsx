"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="main">
      <section className="panel narrow-panel">
        <p className="eyebrow">Recovery mode</p>
        <h1 style={{ fontSize: "2rem" }}>Maintiva could not load this view</h1>
        <p>
          This usually happens when the production database has not received the latest Prisma migrations,
          or when required database environment variables are missing.
        </p>
        {error.digest ? <p className="badge danger">Digest: {error.digest}</p> : null}
        <div className="row" style={{ justifyContent: "flex-start", marginTop: 16 }}>
          <button className="button" onClick={reset} type="button"><AlertTriangle /> Try again</button>
          <Link className="button secondary" href="/login">Back to login</Link>
        </div>
      </section>
    </main>
  );
}
